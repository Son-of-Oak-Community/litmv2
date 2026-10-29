import { reconcileTagEffects } from "../../active-effects/effect-factories.js";
import { startsHiddenOn } from "../../active-effects/effect-queries.js";
import { parseTagString } from "../../item/action/tag-string.js";
import { LitmItem } from "../../item/litm-item.js";
import { error } from "../../logger.js";
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
		// Foundry doesn't await hook callbacks; a failure here would otherwise
		// surface only as an unhandled rejection.
		try {
			await LitmItem.createLegacyEffects(item);
			await LitmItem.ensureTitleTag(item);
		} catch (err) {
			error(`Setting up item ${item.name} failed`, err);
		}
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
 *
 * Like every mirror-sync hook below (and `_syncStoryThemeActorToItem` in
 * actor-hooks), this fires on every connected client but must write from one.
 * Gate to the user who made the change: an embedded document's ownership comes
 * from its parent (Foundry's `BaseItem#getUserLevel` ignores an embedded item's
 * own ownership field; an effect has none), so whoever could edit the item owns
 * the effect, actor, or effects being mirrored to. Without the gate a
 * non-owner's write is refused and, on the Fellowship (OWNER for everyone),
 * every client writes at once.
 */
function _syncTitleTagOnRename() {
	Hooks.on("updateItem", (item, data, _options, userId) => {
		if (userId !== game.userId) return;
		if (item.type !== "theme" && item.type !== "story_theme") return;
		if (!("name" in data)) return;
		const titleTag = item.system.themeTag;
		if (!titleTag || titleTag.name === data.name) return;
		titleTag.update({ name: data.name }).catch(console.error);
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
	Hooks.on("updateItem", (item, data, _options, userId) => {
		if (userId !== game.userId) return;
		if (item.type !== "story_theme") return;
		const actor = item.parent;
		if (!actor || actor.type !== "story_theme") return;

		const updates = {};
		if ("name" in data && actor.name !== data.name) updates.name = data.name;
		if ("img" in data && actor.img !== data.img) updates.img = data.img;
		if (Object.keys(updates).length) actor.update(updates).catch(console.error);
	});
}

function _syncAddonEffectsOnUpdate() {
	Hooks.on("updateItem", (item, _data, _options, userId) => {
		if (userId !== game.userId) return;
		if (item.type !== "addon") return;
		const actor = item.parent;
		if (!actor || actor.documentName !== "Actor") return;
		resyncAddonEffects(actor, item).catch(console.error);
	});
}

function _cleanupAddonEffectsOnDelete() {
	Hooks.on("deleteItem", async (item, _options, userId) => {
		if (userId !== game.userId) return;
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
 * Effect creation data for an addon's tag string, flagged with the addon's ID
 * for later cleanup. Addons live on Challenges, whose tags start hidden
 * unless a player owns the Challenge.
 * @param {Item} addonItem    The addon item whose tags to read
 * @returns {object[]}
 */
function addonEffectData(addonItem) {
	return parseTagString(addonItem.system.tags).map((data) => ({
		...data,
		system: { ...data.system, isHidden: startsHiddenOn(addonItem.parent) },
		flags: { litmv2: { addonId: addonItem.id } },
	}));
}

/**
 * Parse an addon item's tag string and create matching ActiveEffects on the parent actor.
 * @param {Actor} actor       The parent actor
 * @param {Item} addonItem    The addon item whose tags to sync
 */
export async function syncAddonEffects(actor, addonItem) {
	const effects = addonEffectData(addonItem);
	if (!effects.length) return;

	await actor.createEmbeddedDocuments("ActiveEffect", effects);
}

/**
 * The last queued resync per addon item.
 * @type {WeakMap<Item, Promise>}
 */
const resyncQueues = new WeakMap();

/**
 * Converge an addon's synced effects onto its current tags. Tags that are
 * still there keep their play state — revealed, scratched — so editing an
 * addon never re-hides what the Narrator already showed.
 * @param {Actor} actor       The parent actor
 * @param {Item} addonItem    The updated addon item
 */
export async function resyncAddonEffects(actor, addonItem) {
	// Each run reads the effects, then creates the missing ones. Two quick edits
	// would both see a new tag missing and both create it, so runs take turns,
	// and each reads the addon's tags when its turn comes.
	const turn = (resyncQueues.get(addonItem) ?? Promise.resolve()).then(() =>
		reconcileTagEffects(actor, addonEffectData(addonItem), {
			filter: (e) => e.getFlag("litmv2", "addonId") === addonItem.id,
		}),
	);
	resyncQueues.set(
		addonItem,
		turn.catch(() => {}),
	);
	return turn;
}
