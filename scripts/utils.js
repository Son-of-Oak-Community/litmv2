import { ContentSources } from "./system/content-sources.js";

/**
 * Extract and remove keys matching a prefix from form data, returning a
 * nested map keyed by document ID. Uses `foundry.utils.setProperty` for
 * clean nested path handling.
 * @param {object} submitData  The form data object (mutated: matching keys are deleted)
 * @param {string} prefix      Key prefix to match, e.g. "effects." or "items."
 * @returns {Record<string, object>}  Map of `{ [id]: nestedData }`
 */
export function parseEmbeddedFormKeys(submitData, prefix) {
	const map = {};
	for (const [key, value] of Object.entries(submitData)) {
		if (!key.startsWith(prefix)) continue;
		delete submitData[key];
		const parts = key.split(".");
		const id = parts[1];
		const field = parts.slice(2).join(".");
		map[id] ??= {};
		foundry.utils.setProperty(map[id], field, value);
	}
	return map;
}

export function levelIcon(level) {
	return `systems/litmv2/assets/media/icons/${level}.svg`;
}

export function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function localize(...key) {
	if (key.length === 1) return game.i18n.localize(key[0]);
	return key.map((k) => game.i18n.localize(k)).join(" ");
}

export function titleCase(str) {
	return (
		str.charAt(0).toUpperCase() +
		str
			.toLowerCase()
			.replace(/\b\w+/g, (l) => {
				if (["and", "the", "of", "or", "a", "an"].includes(l)) return l;
				return l.charAt(0).toUpperCase() + l.slice(1);
			})
			.slice(1)
	);
}

export async function findThemebookByName(name) {
	if (!name) return null;

	// Check world items first (already loaded, no cost)
	const worldMatch = game.items.find(
		(item) => item.type === "themebook" && item.name === name,
	);
	if (worldMatch) return worldMatch;

	// Search compendium indices (lightweight) and load only the matching document
	const packs = game.packs.filter((pack) => pack.documentName === "Item");
	for (const pack of packs) {
		const index = await pack.getIndex({ fields: ["type"] });
		const entry = index.find((e) => e.type === "themebook" && e.name === name);
		if (entry) return pack.getDocument(entry._id);
	}

	return null;
}

/**
 * Enrich HTML text with Foundry enrichers.
 * @param {string} text          The HTML text to enrich
 * @param {Document} document    The document context for enrichment
 * @returns {Promise<string>}
 */
export async function enrichHTML(text, document) {
	if (!text) return "";
	const TextEditor = foundry.applications.ux.TextEditor;
	return (
		(await TextEditor.enrichHTML(text, {
			secrets: document.isOwner,
			relativeTo: document,
		})) || ""
	);
}

export function toQuestionOptions(questions = [], skipFirst = 0) {
	const options = {};

	(questions || []).forEach((question, idx) => {
		if (idx < skipFirst) return;
		if (!question || `${question}`.trim().length === 0) return;

		options[String(idx)] = idx < 26 ? String.fromCharCode(65 + idx) : `${idx + 1}`;
	});

	return options;
}

export function effectToPlain(e) {
	return {
		_id: e._id,
		id: e.id ?? e._id,
		uuid: e.uuid,
		name: e.name,
		type: e.type,
		system: e.system,
		active: e.active,
		themeId: e.parent?.id,
		themeName: e.parent?.name,
	};
}

export function powerTagEffect({
	name,
	isActive = false,
	question = null,
	isScratched = false,
} = {}) {
	return {
		name: name || game.i18n.localize("LITM.Terms.tag"),
		type: "power_tag",
		disabled: !isActive,
		system: { question, isScratched },
	};
}

export function weaknessTagEffect({
	name,
	isActive = false,
	question = null,
} = {}) {
	return {
		name: name || game.i18n.localize("LITM.Terms.tag"),
		type: "weakness_tag",
		disabled: !isActive,
		system: { question },
	};
}

export function fellowshipTagEffect({
	name,
	isActive = false,
	question = null,
	isScratched = false,
} = {}) {
	return {
		name: name || game.i18n.localize("LITM.Terms.tag"),
		type: "fellowship_tag",
		disabled: !isActive,
		system: { question, isScratched },
	};
}

export function relationshipTagEffect({
	name,
	targetId = "",
} = {}) {
	return {
		name: name || game.i18n.localize("LITM.Terms.tag"),
		type: "relationship_tag",
		system: { targetId },
	};
}

/**
 * Build ActiveEffect creation data for a story_tag effect.
 * @param {object} options
 * @param {string} options.name - Tag name
 * @param {boolean} [options.isScratched=false]
 * @param {boolean} [options.isSingleUse=false]
 * @param {boolean} [options.isHidden=false]
 * @param {string|null} [options.limitId=null]
 * @returns {object} Effect creation data
 */
export function storyTagEffect({
	name,
	isScratched = false,
	isSingleUse = false,
	isHidden = false,
	limitId = null,
} = {}) {
	return {
		name: name || game.i18n.localize("LITM.Terms.tag"),
		type: "story_tag",
		system: { isScratched, isSingleUse, isHidden, limitId },
	};
}

/**
 * Build ActiveEffect creation data for a status_card effect.
 * @param {object} options
 * @param {string} options.name - Status name
 * @param {boolean[]} [options.tiers] - 6-element tier array
 * @param {boolean} [options.isHidden=false]
 * @param {string|null} [options.limitId=null]
 * @returns {object} Effect creation data
 */
export function statusTagEffect({
	name,
	tiers = [false, false, false, false, false, false],
	isHidden = false,
	limitId = null,
} = {}) {
	return {
		name: name || game.i18n.localize("LITM.Terms.status"),
		type: "status_tag",
		system: { tiers, isHidden, limitId },
	};
}

/**
 * Route effect updates to the correct parent document and batch-apply them.
 * Effects may live on the actor directly or on embedded items (e.g. backpack).
 * Builds an id→effect lookup once, then groups updates by parent.
 * @param {Actor} actor    The actor whose applicable effects to search
 * @param {object[]} updates  Array of update objects with `_id` keys
 */
export async function updateEffectsByParent(actor, updates) {
	if (!updates.length) return;
	const effectMap = new Map(
		[...actor.allApplicableEffects()].map((e) => [e.id, e]),
	);
	const byParent = new Map();
	for (const u of updates) {
		const parent = effectMap.get(u._id)?.parent ?? actor;
		if (!byParent.has(parent)) byParent.set(parent, []);
		byParent.get(parent).push(u);
	}
	for (const [parent, parentUpdates] of byParent) {
		await parent.updateEmbeddedDocuments("ActiveEffect", parentUpdates);
	}
}

/**
 * Query items from world items and compendium packs.
 * Iterates world items and compendium pack indices, filtering by type
 * and an optional predicate, and returns deduplicated results.
 * @param {object} options
 * @param {string} options.type                Item type to filter by (e.g. "themebook", "theme")
 * @param {Function} [options.filter]          Optional predicate receiving each item/index entry
 * @param {string[]} [options.indexFields=[]]  Extra fields to request via pack.getIndex
 * @param {Function} [options.map]             Optional mapper; receives (entry, {pack}) and returns
 *                                             the value to include. If omitted, entries are returned as-is.
 * @returns {Promise<any[]>}
 */

export async function queryItemsFromPacks({
	type,
	filter,
	indexFields = [],
	map,
	category,
} = {}) {
	const results = [];

	// World items
	for (const item of game.items.filter((it) => it.type === type)) {
		if (filter && !filter(item)) continue;
		results.push(map ? map(item, { pack: null }) : item);
	}

	// Compendium packs
	const packs = category
		? ContentSources.getPacks(category)
		: game.packs.filter((pack) => pack.documentName === "Item");
	for (const pack of packs) {
		await pack.getIndex({ fields: ["type", "name", ...indexFields] });
		for (const entry of pack.index?.contents || []) {
			if (entry.type !== type) continue;
			if (filter && !filter(entry)) continue;
			results.push(map ? map(entry, { pack }) : entry);
		}
	}

	return results;
}

export async function confirmDelete(string = "Item") {
	const thing = game.i18n.localize(string);
	try {
		return await foundry.applications.api.DialogV2.confirm({
			window: {
				title: game.i18n.format("LITM.Ui.confirm_delete_title", { thing }),
			},
			content: game.i18n.format("LITM.Ui.confirm_delete_content", { thing }),
			no: { default: true },
			classes: ["litm", "litm--confirm-delete"],
		});
	} catch {
		// DialogV2 throws when closed via the X button — treat as rejection
		return false;
	}
}

/**
 * Find an ActiveEffect by ID, searching the actor's applicable effects
 * (own + transferred from items), then optionally the fellowship actor.
 * @param {string} effectId
 * @param {Actor} actor
 * @param {{ fellowship?: boolean }} [options]
 * @returns {ActiveEffect|null}
 */
export function resolveEffect(effectId, actor, { fellowship = true } = {}) {
	for (const e of actor.allApplicableEffects()) {
		if (e.id === effectId) return e;
	}
	if (fellowship) {
		const f = actor.system?.fellowshipActor;
		if (f) {
			for (const e of f.allApplicableEffects()) {
				if (e.id === effectId) return e;
			}
		}
	}
	return null;
}
