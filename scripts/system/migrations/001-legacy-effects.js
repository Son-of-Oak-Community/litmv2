import { buildRelationshipEffects } from "../../actor/hero/hero-data.js";
import { error, warn } from "../../logger.js";
import {
	buildBackpackTagEffects,
	buildThemeTagEffects,
} from "../../item/litm-item.js";

/**
 * Collect all effect changes for an actor and its items.
 */
async function collectActorChanges(actor, changes) {
	const entry = getEntry(changes, actor);

	// Re-save legacy status_card effects with the corrected type.
	// migrateData renames status_card → status_tag in memory.
	// Skip for synthetic token actors — their effects collection is a
	// merge of base actor + delta. IDs inherited from the base don't
	// exist in the delta, so deleteDocuments fails. migrateData still
	// renames the type in memory on every load for any delta effects.
	if (!actor.isToken) {
		for (const e of actor.effects) {
			if (e.type !== "status_tag") continue;
			entry.toUpdate.push({
				_id: e._id,
				type: "status_tag",
				system: _replace(e.system.toObject() || {}),
			});
		}
	}

	// Create relationship_tag effects from legacy relationships stashed
	// as a flag by HeroData.migrateData, then clean up the DB.
	if (actor.type === "hero") {
		const rels = actor.getFlag("litmv2", "legacyRelationships");
		if (
			Array.isArray(rels) && rels.length &&
			!actor.effects.some((e) => e.type === "relationship_tag")
		) {
			entry.toCreate.push(...buildRelationshipEffects(rels));
			entry.flagsToUnset.push("legacyRelationships");
		}
		entry.systemFieldsToUnset.push("relationships");
	}

	for (const item of actor.items) {
		collectItemChanges(item, changes);
	}
}

/**
 * Collect legacy tag data from an item's flags.
 */
function collectItemChanges(item, changes) {
	if (item.type === "theme" || item.type === "story_theme") {
		const legacy = item.getFlag("litmv2", "legacyTags");
		if (!legacy) return;
		if (item.effects.size) return; // Already migrated

		const entry = getEntry(changes, item);
		entry.toCreate.push(...buildThemeTagEffects(legacy, {
			name: item.name,
			isScratched: item.system?.isScratched ?? false,
		}));
		entry.flagsToUnset.push("legacyTags");
		entry.systemFieldsToUnset.push("powerTags", "weaknessTags");
	}

	if (item.type === "backpack") {
		const contents = item.getFlag("litmv2", "legacyContents");
		if (!Array.isArray(contents) || !contents.length) return;
		if (item.effects.some((e) => e.type === "story_tag")) return; // Already migrated

		const entry = getEntry(changes, item);
		entry.toCreate.push(...buildBackpackTagEffects(contents));
		entry.flagsToUnset.push("legacyContents");
		entry.systemFieldsToUnset.push("contents");
	}
}

function getEntry(changes, parent) {
	const uuid = parent.uuid;
	if (!changes.has(uuid)) {
		changes.set(uuid, {
			parentUuid: uuid,
			isItem: parent.documentName === "Item",
			toCreate: [],
			toUpdate: [],
			flagsToUnset: [],
			systemFieldsToUnset: [],
		});
	}
	return changes.get(uuid);
}

/**
 * Apply all collected changes in three phases:
 * 1. Updates —  to clear invalid types (e.g. status_card)
 *    from the DB before any item operations touch the parent actor.
 * 2. Creates — items first so their effects exist before actor creates
 *    trigger re-initialization hooks and migrateData guards.
 * 3. Flag cleanup — unset consumed legacy flags.
 */
async function applyChanges(changes) {
	const failures = [];
	const AE = CONFIG.ActiveEffect.documentClass;
	const entries = [...changes.values()];

	// Phase 1: Updates Active Effects  status_card -> status_tag
	for (const { parentUuid, toUpdate } of entries) {
		if (!toUpdate.length) continue;
		await AE.updateDocuments(
			toUpdate,
			{ parentUuid, diff: false },
		);
	}

	// Phase 2: creates — items before actors
	const createsItemsFirst = entries.toSorted((a, b) =>
		a.isItem === b.isItem ? 0 : a.isItem ? -1 : 1
	);
	for (const { parentUuid, toCreate } of createsItemsFirst) {
		if (!toCreate.length) continue;
		try {
			await AE.createDocuments(toCreate, { parentUuid });
		} catch (err) {
			failures.push({ uuid: parentUuid, error: err });
		}
	}

	// Phase 3: clean legacy source data and flags from the DB so
	// migrateData won't re-synthesize the flags on future loads.
	const { ForcedDeletion } = foundry.data.operators;
	for (const { parentUuid, flagsToUnset, systemFieldsToUnset } of entries) {
		if (!flagsToUnset.length && !systemFieldsToUnset.length) continue;
		try {
			const doc = await fromUuid(parentUuid);
			const update = {};
			if (flagsToUnset.length) {
				const flags = {};
				for (const flag of flagsToUnset) flags[flag] = new ForcedDeletion();
				update.flags = { litmv2: flags };
			}
			if (systemFieldsToUnset.length) {
				const system = {};
				for (const field of systemFieldsToUnset) {
					system[field] = new ForcedDeletion();
				}
				update.system = system;
			}
			await doc.update(update);
		} catch (err) {
			failures.push({ uuid: parentUuid, error: err });
		}
	}

	return failures;
}

export async function migrate() {
	const changes = new Map();

	for (const actor of game.actors) {
		collectActorChanges(actor, changes);
	}

	for (const item of game.items) {
		collectItemChanges(item, changes);
	}

	for (const scene of game.scenes) {
		for (const token of scene.tokens) {
			if (token.actorLink || !token.actor) continue;
			collectActorChanges(token.actor, changes);
		}
	}

	const failures = await applyChanges(changes);

	if (failures.length) {
		warn(`Migration v1: ${failures.length} document(s) failed to migrate:`);
		for (const f of failures) error(`  ${f.uuid}`, f.error);
	}
}
