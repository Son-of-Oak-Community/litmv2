import { LitmItem } from "../item/litm-item.js";
import { error, info } from "../logger.js";
import { localize as t } from "../utils.js";
import { LitmSettings } from "./settings.js";

/**
 * Registry of world-level migrations.
 * Each entry has a `version` (sequential integer) and an async `migrate` function.
 * Migrations run in ascending order for any version higher than the stored
 * migration version. The version counter is independent of the system version
 * in system.json — it tracks only how many migrations have been applied.
 *
 * To add a new migration:
 * 1. Add an entry to MIGRATIONS with the next sequential version number
 *
 * Example:
 * { version: 1, migrate: async () => { ... } }
 */
/**
 * Migrate a single item's legacy tag arrays to ActiveEffects.
 * @param {Item} item
 */
async function _migrateItemTags(item) {
	await LitmItem.createLegacyEffects(item);
}

async function _migrateActorEffects(actor) {
	// migrateData already renamed types in memory (_source reflects the
	// migrated state). Force-write the current effects back to the DB
	// so the raw DB matches. Skip actors with no effects.
	if (!actor._source?.effects?.length) return;
	await actor.update({ effects: actor._source.effects });
}

async function _migrateRelationships(actor) {
	if (actor.type !== "hero") return;
	if (actor.effects.some((e) => e.type === "relationship_tag")) return;
	const relationships = actor._source?.system?.relationships ?? [];
	if (!relationships.length) return;
	const effects = relationships
		.filter((r) => r.tag && r.actorId)
		.map((r) => ({
			name: r.tag,
			type: "relationship_tag",
			system: { targetId: r.actorId, isScratched: r.isScratched ?? false },
		}));
	if (effects.length) {
		await actor.createEmbeddedDocuments("ActiveEffect", effects);
	}
}

/**
 * Migrate any document — dispatches to the appropriate handler based on type.
 * Handles Actors, Items, Scenes (with tokens), and Adventures (recursively).
 * @param {Document} doc
 */
async function _migrateDocument(doc) {
	if (doc.documentName === "Actor") {
		for (const item of doc.items) {
			await _migrateItemTags(item);
		}
		await _migrateActorEffects(doc);
		await _migrateRelationships(doc);
	} else if (doc.documentName === "Item") {
		await _migrateItemTags(doc);
	} else if (doc.documentName === "Scene") {
		for (const token of doc.tokens) {
			if (token.actorLink || !token.actor) continue;
			await _migrateDocument(token.actor);
		}
	} else if (doc.documentName === "Adventure") {
		for (const actor of doc.actors ?? []) {
			await _migrateDocument(actor);
		}
		for (const item of doc.items ?? []) {
			await _migrateDocument(item);
		}
		for (const scene of doc.scenes ?? []) {
			await _migrateDocument(scene);
		}
	}
}

const MIGRATIONS = [
	{
		version: 1,
		migrate: async () => {
			// World actors
			for (const actor of game.actors) {
				try { await _migrateDocument(actor); }
				catch (err) { error(`Migration: ${actor.uuid}`, err); }
			}

			// World items
			for (const item of game.items) {
				try { await _migrateDocument(item); }
				catch (err) { error(`Migration: ${item.uuid}`, err); }
			}

			// World scenes (unlinked token actors)
			for (const scene of game.scenes) {
				try { await _migrateDocument(scene); }
				catch (err) { error(`Migration: ${scene.uuid}`, err); }
			}

			// Compendium packs are handled by LitmActiveEffect.migrateData
			// and LitmItem.migrateData on load — no runtime DB migration needed.
			// System packs ship with correct source files. User-edited packs
			// get their types transparently renamed in memory via migrateData.
		},
	},
];

/**
 * Run all pending world-level migrations.
 * Called once during the "ready" hook, GM-only.
 */
export async function migrateWorld() {
	if (!game.user.isGM) return;

	const storedVersion = LitmSettings.systemMigrationVersion;

	// First load ever — stamp and skip
	if (storedVersion === -1) {
		const latest = MIGRATIONS.length
			? Math.max(...MIGRATIONS.map((m) => m.version))
			: 0;
		info(`First world load — stamping migration version to ${latest}`);
		await LitmSettings.setSystemMigrationVersion(latest);
		return;
	}

	// Collect and sort pending migrations
	const pending = MIGRATIONS.filter((m) => m.version > storedVersion).sort(
		(a, b) => a.version - b.version,
	);
	if (!pending.length) return;

	// Run pending migrations in order
	ui.notifications.info(t("LITM.Ui.migration_start"), { permanent: true });

	for (const { version, migrate } of pending) {
		try {
			info(`Running migration to version ${version}...`);
			await migrate();
			info(`Migration to version ${version} complete`);
		} catch (err) {
			const error =
				err instanceof Error ? err : new Error(String(err), { cause: err });
			Hooks.onError("litmv2.migrateWorld", error, {
				msg: `[litmv2] Migration to version ${version} failed`,
				log: "error",
				notify: null,
			});
			ui.notifications.error(t("LITM.Ui.migration_failed"), {
				permanent: true,
				console: false,
			});
			// Stop running further migrations on failure
			return;
		}
	}

	// Stamp the highest migration version applied
	const highestApplied = pending[pending.length - 1].version;
	await LitmSettings.setSystemMigrationVersion(highestApplied);

	ui.notifications.info(t("LITM.Ui.migration_complete"), { permanent: true });
}
