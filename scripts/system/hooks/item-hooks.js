import { createLegacyRelationshipEffects } from "../../actor/hero/hero-data.js";
import { LitmItem } from "../../item/litm-item.js";
import { getDefaultItemIcon, levelIcon, parseTagStringMatch } from "../../utils.js";

export function registerItemHooks() {
	_prepareThemeOnCreate();
	_migrateLegacyItemOnCreate();
	_syncTitleTagOnRename();
	_syncThemeImageOnLevelChange();
	_syncAddonEffectsOnUpdate();
	_cleanupAddonEffectsOnDelete();
	_hideStoryThemeFromCreateDialog();
	_syncStoryThemeItemToActor();
}

/**
 * When an item with stashed legacy data is created (e.g. compendium import),
 * create proper AEs from the stashed flag data.
 */
function _migrateLegacyItemOnCreate() {
	Hooks.on("createItem", async (item) => {
		await LitmItem.createLegacyEffects(item);
		await LitmItem.ensureTitleTag(item);
	});
	// Actor import — embedded items don't fire createItem
	Hooks.on("createActor", async (actor) => {
		for (const item of actor.items) {
			if (item.flags?.litmv2?.legacyTags || item.flags?.litmv2?.legacyContents) {
				await LitmItem.createLegacyEffects(item);
			}
			await LitmItem.ensureTitleTag(item);
		}
		await createLegacyRelationshipEffects(actor);
	});
}

function _prepareThemeOnCreate() {
	Hooks.on("preCreateItem", (item, data) => {
		if (item.img !== "icons/svg/item-bag.svg") return;

		const img = getDefaultItemIcon(data.type, data.system) ?? CONFIG.litmv2.assets.icons.default;
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

function _hideStoryThemeFromCreateDialog() {
	Hooks.once("ready", () => {
		const ItemCls = foundry.documents.Item;
		const original = ItemCls.createDialog;
		ItemCls.createDialog = function (data, options, dialogOptions = {}) {
			dialogOptions.types ??= ItemCls.TYPES.filter(
				(type) => type !== "story_theme",
			);
			return original.call(this, data, options, dialogOptions);
		};
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
	const tags = addonItem.system.tags;
	if (!tags) return;

	const matches = Array.from(tags.matchAll(CONFIG.litmv2.tagStringRe));
	if (!matches.length) return;

	const effects = matches.map((match) => ({
		...parseTagStringMatch(match),
		flags: { litmv2: { addonId: addonItem.id } },
	}));

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
