import { parseTagString } from "../../item/action/tag-string.js";
import { LitmItem } from "../../item/litm-item.js";
import { getDefaultItemIcon, levelIcon } from "../../utils.js";

export function registerItemHooks() {
	_prepareThemeOnCreate();
	_migrateLegacyItemOnCreate();
	_syncTitleTagOnRename();
	_syncThemeImageOnLevelChange();
	_syncAddonEffectsOnUpdate();
	_cleanupAddonEffectsOnDelete();
	_syncStoryThemeItemToActor();
}

/**
 * When an item with stashed legacy data is created (e.g. compendium import),
 * create proper AEs from the stashed flag data.
 *
 * createItem fires on every connected client, but the follow-up writes
 * (createLegacyEffects, ensureTitleTag) must run on exactly one of them —
 * otherwise the GM and the creating player both create a title tag, leaving a
 * duplicate (invisible on the sheet, doubled in the roll dialog). Gate to the
 * user who triggered the creation; they own the new item and can mutate it.
 */
function _migrateLegacyItemOnCreate() {
	Hooks.on("createItem", async (item, _options, userId) => {
		if (userId !== game.userId) return;
		await LitmItem.createLegacyEffects(item);
		await LitmItem.ensureTitleTag(item);
	});
}

function _prepareThemeOnCreate() {
	Hooks.on("preCreateItem", (item, data) => {
		if (item.img !== CONFIG.litmv2.assets.icons.default) return;

		const img =
			getDefaultItemIcon(data.type, data.system) ??
			CONFIG.litmv2.assets.icons.default;
		item.updateSource({ img });
	});
}

/**
 * When a theme or story_theme is renamed, sync the title tag effect name.
 */
function _syncTitleTagOnRename() {
	Hooks.on("updateItem", (item, data) => {
		if (item.type !== "theme" && item.type !== "story_theme") return;
		if (!("name" in data)) return;
		const titleTag = item.system.themeTag;
		if (!titleTag || titleTag.name === data.name) return;
		titleTag.update({ name: data.name });
	});
}

const LEVEL_FIELD = { theme: "level", themebook: "theme_level" };

function _syncThemeImageOnLevelChange() {
	Hooks.on("preUpdateItem", (item, data) => {
		const field = LEVEL_FIELD[item.type];
		if (!field) return;
		const newLevel = data.system?.[field] ?? data[`system.${field}`];
		if (newLevel) {
			data.img = levelIcon(newLevel);
		}
	});
}

/**
 * Sync story_theme item name/image back to its parent actor when the item changes.
 */
function _syncStoryThemeItemToActor() {
	Hooks.on("updateItem", (item, data) => {
		if (item.type !== "story_theme") return;
		const actor = item.parent;
		if (!actor || actor.type !== "story_theme") return;

		const updates = {};
		if ("name" in data && actor.name !== data.name) updates.name = data.name;
		if ("img" in data && actor.img !== data.img) updates.img = data.img;
		if (Object.keys(updates).length) actor.update(updates);
	});
}

function _syncAddonEffectsOnUpdate() {
	Hooks.on("updateItem", (item) => {
		if (item.type !== "addon") return;
		const actor = item.parent;
		if (!actor || actor.documentName !== "Actor") return;
		resyncAddonEffects(actor, item);
	});
}

function _cleanupAddonEffectsOnDelete() {
	Hooks.on("deleteItem", async (item) => {
		if (item.type !== "addon") return;
		const actor = item.parent;
		if (!actor || actor.documentName !== "Actor") return;
		const addonEffects = actor.effects
			.filter((e) => e.getFlag("litmv2", "addonId") === item.id)
			.map((e) => e.id);
		if (addonEffects.length) {
			await actor.deleteEmbeddedDocuments("ActiveEffect", addonEffects);
		}
	});
}

/**
 * Parse an addon item's tag string and create matching ActiveEffects on the parent actor.
 * Each effect is flagged with the addon's ID for later cleanup.
 * @param {Actor} actor       The parent actor
 * @param {Item} addonItem    The addon item whose tags to sync
 */
export async function syncAddonEffects(actor, addonItem) {
	const effects = parseTagString(addonItem.system.tags).map((data) => ({
		...data,
		flags: { litmv2: { addonId: addonItem.id } },
	}));
	if (!effects.length) return;

	await actor.createEmbeddedDocuments("ActiveEffect", effects);
}

/**
 * Delete existing ActiveEffects from an addon, then recreate from its current tags.
 * @param {Actor} actor       The parent actor
 * @param {Item} addonItem    The updated addon item
 */
export async function resyncAddonEffects(actor, addonItem) {
	const toDelete = actor.effects
		.filter((e) => e.getFlag("litmv2", "addonId") === addonItem.id)
		.map((e) => e.id);
	if (toDelete.length) {
		await actor.deleteEmbeddedDocuments("ActiveEffect", toDelete);
	}
	await syncAddonEffects(actor, addonItem);
}
