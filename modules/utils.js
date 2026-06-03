import { getDefaultThemeLevel, ITEM_DEFAULT_ICONS } from "./system/config.js";
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

const KNOWN_LEVEL_ICONS = new Set([
	"origin",
	"adventure",
	"greatness",
	"variable",
]);

export function levelIcon(level) {
	const safe = KNOWN_LEVEL_ICONS.has(level) ? level : "origin";
	return `systems/litmv2/assets/media/icons/${safe}.svg`;
}

/**
 * Returns the default icon for an item type.
 * @param {string} type - Item document type
 * @param {object} [system] - Item's system data (for level-dependent icons)
 * @returns {string|null} Icon path, or null if no default
 */
export function getDefaultItemIcon(type, system = {}) {
	if (type === "theme") {
		const level = system.level ?? getDefaultThemeLevel();
		return levelIcon(level);
	}
	if (type === "themebook") {
		const level = system.theme_level ?? "origin";
		return levelIcon(level);
	}
	return ITEM_DEFAULT_ICONS[type] ?? null;
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
 * Compute the set of themebook special-improvement entries not yet claimed on
 * a theme. Two entries are considered the same when both `name` and
 * `description` match. Empty entries (no name and no description) are skipped.
 * @param {Array<{name?: string, description?: string}>} claimed
 * @param {Array<{name?: string, description?: string}>} themebookEntries
 * @returns {Array<{index: number, name: string, description: string}>}
 */
export function availableThemebookImprovements(
	claimed = [],
	themebookEntries = [],
) {
	return themebookEntries
		.map((entry, index) => ({ ...entry, index }))
		.filter((entry) => entry?.name || entry?.description)
		.filter(
			(entry) =>
				!claimed.some(
					(c) => c.name === entry.name && c.description === entry.description,
				),
		);
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

		options[String(idx)] =
			idx < 26 ? String.fromCharCode(65 + idx) : `${idx + 1}`;
	});

	return options;
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
 * Transfer story tag effects between two backpack items.
 * Copies the chosen effects from `sourceItem` to `targetItem`, then deletes
 * the originals from `sourceItem`.
 * @param {Item} sourceItem   The item to transfer effects from
 * @param {Item} targetItem   The item to transfer effects to
 * @param {string[]} tagIds   IDs of the effects to transfer
 * @returns {Promise<void>}
 */
export async function transferBackpackTags(sourceItem, targetItem, tagIds) {
	const sourceEffects = sourceItem.effects.filter(
		(e) => e.type === "story_tag" && tagIds.includes(e.id),
	);
	if (!sourceEffects.length) return;

	const effectData = sourceEffects.map((e) => ({
		name: e.name,
		type: "story_tag",
		disabled: e.disabled,
		system: e.system.toObject(),
	}));
	await targetItem.createEmbeddedDocuments("ActiveEffect", effectData);
	await sourceItem.deleteEmbeddedDocuments(
		"ActiveEffect",
		sourceEffects.map((e) => e.id),
	);
}

/**
 * Remove an element at the given index from an array field and update the document.
 * @param {Document} doc   The Foundry document to update
 * @param {string} path    The dot-notation path to the array field (e.g. "system.limits")
 * @param {number} index   The index to remove
 */
export async function removeAtIndex(doc, path, index) {
	const arr = foundry.utils.getProperty(doc, path) ?? [];
	await doc.update({ [path]: arr.filter((_, i) => i !== index) });
}

/**
 * Get the story tag sidebar application instance.
 * Encapsulates the game.litmv2.storyTags ?? ui.combat fallback.
 * @returns {StoryTagSidebar|null}
 */
export function getStoryTagSidebar() {
	return game.litmv2?.storyTags ?? ui.combat ?? null;
}

/**
 * Resolve the Fellowship theme item on a fellowship actor.
 * @param {Actor|null} actor
 * @returns {Item|null}
 */
export function findFellowshipTheme(actor) {
	return (
		actor?.items?.find((i) => i.type === "theme" && i.system?.isFellowship) ??
		null
	);
}

/**
 * Resolve a linked-reference UUID and render the appropriate sheet.
 * Accepts JournalEntry, JournalEntryPage, or Item (action) UUIDs;
 * journal pages render their parent entry focused on the page.
 * @param {string} uuid
 * @returns {Promise<void>}
 */
async function openLinkedRef(uuid) {
	if (!uuid) return;
	const doc = await foundry.utils.fromUuid(uuid);
	if (!doc) {
		ui.notifications.warn(localize("LITM.Actions.ref_not_found"));
		return;
	}
	if (doc.documentName === "JournalEntryPage") {
		doc.parent.sheet.render(true, { pageId: doc.id });
		return;
	}
	doc.sheet?.render(true);
}

/**
 * Shared `viewLinkedRef` action handler. Suitable for use directly in any
 * ApplicationV2 `actions:` map. Reads the UUID from the closest ancestor
 * with `data-linked-ref-uuid` (or the target itself).
 * @param {Event} _event
 * @param {HTMLElement} target
 */
export async function viewLinkedRefAction(_event, target) {
	const trigger = target.closest("[data-linked-ref-uuid]") ?? target;
	await openLinkedRef(trigger.dataset.linkedRefUuid);
}

/**
 * Resolve the display name for a linkedRefUuid, or null if none / unresolvable.
 * Used by data-model getters that expose a derived label for templates.
 * @param {string|null|undefined} uuid
 * @returns {string|null}
 */
export function getLinkedRefName(uuid) {
	if (!uuid) return null;
	return foundry.utils.fromUuidSync(uuid)?.name ?? null;
}
