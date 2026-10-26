import { createLegacyActorEffects } from "../../actor/litm-actor.js";
import { error } from "../../logger.js";
import { Sockets } from "../sockets.js";
import {
	findFellowshipTheme,
	getStoryTagSidebar,
	localize as t,
} from "../../utils.js";
import {
	ACTOR_TAG_TYPES,
	ACTOR_TYPES,
	FLAGS,
	THEME_TAG_TYPES,
} from "../config.js";

export function registerActorHooks() {
	_prepareCharacterOnCreate();
	_migrateLegacyActorOnCreate();
	_validateFellowshipThemes();
	_enforceHeroItemLimits();
	_validateEffectType();
	_syncUiOnEffectChange();
	_recalcLimitsOnStatusChange();
	_syncRollDialogHudOnUpdate();
	_flashSacrificeBannerOnUpdate();
	_demoteRollDialogOnSeatTaken();
	_syncStoryThemeActorToItem();
	_enforceStoryThemeActorLimits();
}

function _prepareCharacterOnCreate() {
	Hooks.on("preCreateActor", (actor, data, _options, _userId) => {
		const tokenDefaults = {
			hero: {
				sight: { enabled: true },
				actorLink: true,
				disposition: foundry.CONST.TOKEN_DISPOSITIONS.FRIENDLY,
				displayBars: foundry.CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
				bar1: { attribute: "limit" },
				texture: { src: actor.prototypeToken?.texture?.src || actor.img },
			},
			fellowship: {
				actorLink: true,
				disposition: foundry.CONST.TOKEN_DISPOSITIONS.FRIENDLY,
			},
			challenge: {
				disposition: foundry.CONST.TOKEN_DISPOSITIONS.NEUTRAL,
			},
			journey: {
				disposition: foundry.CONST.TOKEN_DISPOSITIONS.NEUTRAL,
			},
			story_theme: {
				actorLink: true,
				disposition: foundry.CONST.TOKEN_DISPOSITIONS.FRIENDLY,
				texture: { src: actor.prototypeToken?.texture?.src || actor.img },
			},
		};
		const prototypeToken = tokenDefaults[data.type] ?? null;
		if (prototypeToken) actor.updateSource({ prototypeToken });

		// Fellowship actors default to OWNER permission for all players
		if (data.type === "fellowship") {
			actor.updateSource({
				ownership: { default: foundry.CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
			});
			if (actor.img === CONFIG.litmv2.assets.icons.defaultActor) {
				actor.updateSource({
					img: "systems/litmv2/assets/media/icons/fellowship.svg",
				});
			}
		}
	});

	const ACTOR_SETUP = {
		async story_theme(actor) {
			const hasTheme = actor.items.some((i) => i.type === "story_theme");
			if (!hasTheme) {
				await actor.createEmbeddedDocuments("Item", [
					{ name: actor.name, type: "story_theme" },
				]);
			}
		},
		async hero(actor, options) {
			if (options?.litm?.skipAutoSetup) return;
			const themeLimit = CONFIG.litmv2?.themeLimit ?? 4;
			const themes = actor.items.filter((it) => it.type === "theme");
			const missingThemes = Math.max(themeLimit - themes.length, 0);
			if (missingThemes > 0) {
				// Explicit sort: left at 0, the sheet would show them in DB order.
				const lastSort = Math.max(0, ...themes.map((it) => it.sort ?? 0));
				const themeItems = Array(missingThemes)
					.fill()
					.map((_, i) => ({
						name: `${t("TYPES.Item.theme")} ${i + 1}`,
						type: "theme",
						sort: lastSort + (i + 1) * CONST.SORT_INTEGER_DENSITY,
					}));
				await actor.createEmbeddedDocuments("Item", themeItems);
			}
			const backpack = actor.items.find((it) => it.type === "backpack");
			if (!backpack) {
				await actor.createEmbeddedDocuments("Item", [
					{ name: t("TYPES.Item.backpack"), type: "backpack" },
				]);
			}
		},
		async journey(actor) {
			if (!actor.system.generalConsequences) {
				const [vignette] = await actor.createEmbeddedDocuments("Item", [
					{
						name: t("LITM.Terms.general_consequences"),
						type: "vignette",
						"system.isConsequenceOnly": true,
					},
				]);
				await actor.update({
					"system.generalConsequences": vignette?.id || "",
				});
			}
		},
	};

	Hooks.on("createActor", (actor, options) => {
		(async () => {
			// createActor fires on every client; with two GMs online, scaffolding
			// on each would create every default item twice.
			if (game.user !== game.users.activeGM) return;
			// Compendium documents are templates, not playable copies — never
			// auto-scaffold them (the write also fails on locked packs). A world
			// copy made from the pack re-fires this hook and gets scaffolded then.
			if (actor.pack) return;
			await ACTOR_SETUP[actor.type]?.(actor, options);
			if (options?.renderSheet && actor.isOwner) {
				actor.sheet.render(true, { mode: 1 });
			}
		})().catch((err) => error("Failed to setup actor", err));
	});
}

/**
 * Validate and enforce fellowship theme limits (max 1 per hero)
 */
function _validateFellowshipThemes() {
	// Enforce fellowship theme limits on fellowship actors (max 1)
	Hooks.on("preUpdateItem", (item, data, _options, _userId) => {
		const expanded = foundry.utils.expandObject(data);
		if (item.type !== "theme" || !expanded.system?.isFellowship) return;
		if (item.system.isFellowship) return;

		const actor = item.actor;
		if (!actor || actor.type !== "fellowship") return;

		const existingFellowship = actor.items.find(
			(i) => i.type === "theme" && i.system.isFellowship && i.id !== item.id,
		);

		if (existingFellowship) {
			ui.notifications.warn(
				game.i18n.localize("LITM.Ui.warn_fellowship_limit"),
			);
			return false;
		}
	});

	Hooks.on("preCreateItem", (item, data, _options, _userId) => {
		if (item.type !== "theme" || !data.system?.isFellowship) return;

		const actor = item.parent;
		if (!actor || actor.type !== "fellowship") return;

		const existingFellowship = findFellowshipTheme(actor);

		if (existingFellowship) {
			ui.notifications.warn(
				game.i18n.localize("LITM.Ui.warn_fellowship_limit"),
			);
			return false;
		}
	});
}

/**
 * Prevent incompatible effect types from being created on wrong parent documents.
 * Theme-bound tag effects belong on theme/story_theme items only.
 */
function _validateEffectType() {
	Hooks.on("preCreateActiveEffect", (effect) => {
		if (!THEME_TAG_TYPES.has(effect.type)) return;
		const parent = effect.parent;
		if (!parent) return; // Allow creation in compendiums
		if (
			parent.documentName === "Item" &&
			["theme", "story_theme"].includes(parent.type)
		)
			return;
		ui.notifications.warn("LITM.Ui.warn_invalid_effect_target", {
			localize: true,
		});
		return false;
	});
}

/**
 * Re-render all tag-aware UI (sidebar, roll dialogs, hero sheets) when effects change.
 * Centralized here so the HUD, sidebar, macros, etc. don't each need their own hooks.
 */
function _syncUiOnEffectChange() {
	const sync = (effect) => {
		if (!ACTOR_TAG_TYPES.has(effect.type)) return;
		// Sidebar
		const sidebar = getStoryTagSidebar();
		if (sidebar) {
			sidebar.invalidateCache();
			sidebar.render();
			sidebar.refreshRollDialogs();
		}
		// Actor sheet — find the owning actor and re-render
		const actor =
			effect.parent?.documentName === "Actor"
				? effect.parent
				: effect.parent?.parent;
		if (actor?.sheet?.rendered) actor.sheet.render();
	};
	Hooks.on("createActiveEffect", sync);
	Hooks.on("updateActiveEffect", sync);
	Hooks.on("deleteActiveEffect", sync);
}

/**
 * Keep each limit's stored `value` in step with the statuses linked to it, and
 * through `recalculateLimitValues` announce `litm.limitReached` when one crosses
 * its max. Every status write goes through an ActiveEffect create, update or
 * delete — `addStatus`, Spend Power Inflict, chat actions, the token HUD,
 * sheets — so this one choke point covers them all, where only the story-tag
 * sidebar used to recalc.
 *
 * Runs on the client of the user who made the change: it announces once, and
 * that user owns the actor. A status with no limit moves no limit, so only
 * linked statuses (or a change to the link itself) recalc. A recalc rewrites
 * every limit's value as its statuses plus the offset Advance and Set Back left
 * on it (`advanced`), so progress added directly survives it.
 */
function _recalcLimitsOnStatusChange() {
	const recalc = (effect) => {
		const actor =
			effect.parent?.documentName === "Actor"
				? effect.parent
				: effect.parent?.parent;
		if (!actor || actor.pack) return;
		actor.system?.recalculateLimitValues?.()?.catch(console.error);
	};

	Hooks.on("createActiveEffect", (effect, _options, userId) => {
		if (userId !== game.userId) return;
		if (effect.type === "status_tag" && effect.system?.limitId) recalc(effect);
	});
	Hooks.on("updateActiveEffect", (effect, changes, _options, userId) => {
		if (userId !== game.userId) return;
		if (effect.type !== "status_tag") return;
		const system = changes?.system;
		if (!system) return;
		const relinked = "limitId" in system;
		if (!relinked && !("tiers" in system)) return;
		if (relinked || effect.system?.limitId) recalc(effect);
	});
	Hooks.on("deleteActiveEffect", (effect, _options, userId) => {
		if (userId !== game.userId) return;
		if (effect.type === "status_tag" && effect.system?.limitId) recalc(effect);
	});
}

const HERO_ITEM_LIMITS = {
	theme: {
		max: () => CONFIG.litmv2?.themeLimit ?? 4,
		warnKey: "LITM.Ui.warn_theme_limit",
		filter: (i) => i.type === "theme" && !i.system.isFellowship,
	},
	backpack: {
		max: () => 1,
		warnKey: "LITM.Ui.warn_backpack_limit",
		filter: (i) => i.type === "backpack",
	},
};

function _enforceHeroItemLimits() {
	Hooks.on("preCreateItem", (item, _data, _options, _userId) => {
		const actor = item.parent;
		if (!actor || actor.type !== "hero") return;

		const limit = HERO_ITEM_LIMITS[item.type];
		if (!limit) return;
		if (item.type === "theme" && item.system?.isFellowship) return;

		if (actor.items.filter(limit.filter).length >= limit.max()) {
			ui.notifications.warn(game.i18n.localize(limit.warnKey));
			return false;
		}
	});
}

/**
 * Prevent incompatible items on story_theme actors and limit to 1 story_theme item.
 */
function _enforceStoryThemeActorLimits() {
	Hooks.on("preCreateItem", (item) => {
		const actor = item.parent;
		if (!actor || actor.type !== "story_theme") return;

		if (item.type !== "story_theme") {
			ui.notifications.warn(t("LITM.Ui.warn_story_theme_actor_item_type"));
			return false;
		}

		const existing = actor.items.filter((i) => i.type === "story_theme");
		if (existing.length >= 1) {
			ui.notifications.warn(t("LITM.Ui.warn_story_theme_actor_limit"));
			return false;
		}
	});
}

/**
 * Sync story_theme actor name/image to its embedded item when the actor changes.
 * Gated to the user who made the change, who owns the embedded item through the
 * actor — see `_syncTitleTagOnRename` in item-hooks.
 */
function _syncStoryThemeActorToItem() {
	Hooks.on("updateActor", (actor, data, _options, userId) => {
		if (userId !== game.userId) return;
		if (actor.type !== "story_theme") return;
		const theme = actor.system.storyTheme;
		if (!theme) return;

		const updates = {};
		if ("name" in data && theme.name !== data.name) updates.name = data.name;
		if ("img" in data && theme.img !== data.img) updates.img = data.img;
		if (Object.keys(updates).length) theme.update(updates).catch(console.error);
	});
}

/**
 * When an actor is created (embedded items don't fire createItem), create
 * proper AEs from any stashed legacy flag data. Sidebar "Import Data" skips
 * this hook; `LitmActor#importFromJSON` covers it.
 *
 * createActor fires on every connected client; the follow-up writes
 * (ensureTitleTag, relationship effects) must run on exactly one of them.
 * Without this guard a player creating a hero and the GM both run
 * ensureTitleTag, producing a duplicate title tag (hidden on the sheet but
 * doubled in the roll dialog). Gate to the triggering user, who owns the
 * new actor and can mutate it.
 */
function _migrateLegacyActorOnCreate() {
	Hooks.on("createActor", async (actor, _options, userId) => {
		if (userId !== game.userId) return;
		// Foundry doesn't await hook callbacks; log a failure instead of
		// leaving it as an unhandled rejection.
		try {
			await createLegacyActorEffects(actor);
		} catch (err) {
			error(`Setting up actor ${actor.name} failed`, err);
		}
	});
}

/**
 * Re-render the roll dialog HUD when an actor that can host a roll dialog is
 * updated (e.g. flag changes indicating dialog open/close).
 *
 * The Fellowship belongs here as much as a Hero does: Acting Together rides
 * that actor. Gated on the hero type alone, the strip for a group roll never
 * refreshed — it kept showing a call that had already moved on, and never
 * cleared when the roll ended.
 */
const ROLL_DIALOG_HOST_TYPES = new Set([
	ACTOR_TYPES.hero,
	ACTOR_TYPES.fellowship,
]);

function _syncRollDialogHudOnUpdate() {
	Hooks.on("updateActor", (actor) => {
		if (!ROLL_DIALOG_HOST_TYPES.has(actor.type)) return;
		game.litmv2.rollDialogHud?.render?.();
	});
}

/**
 * A player may take the seat of a roll the GM opened from their Hero's sheet
 * (`resolveRollDialogOwnership`). The presence flag then names the player,
 * but the GM's dialog still believed it owned the roll, so both could press
 * Roll. Step down to viewer and follow the new owner's draft.
 *
 * The GM is not the only one who has to hear it. Every other client holding a
 * dialog for the roll still named the old owner, and a dialog only accepts
 * snapshots from the owner it knows, so a third viewer went deaf to the new
 * one. Each of them follows the seat and asks for the draft again.
 */
function _demoteRollDialogOnSeatTaken() {
	Hooks.on("updateActor", (actor, changes) => {
		const flagPath = `flags.litmv2.${FLAGS.rollDialogOwner}`;
		if (!foundry.utils.hasProperty(changes, flagPath)) return;
		const flag = actor.getFlag("litmv2", FLAGS.rollDialogOwner);
		const sheet = actor.sheet;
		if (!flag?.ownerId || !sheet?.hasRollDialog) return;
		const dialog = sheet.rollDialogInstance;
		// The new owner's own client claims the seat itself, in `renderRollDialog`.
		if (flag.ownerId === game.user.id) return;
		if (!dialog.followSeat(flag.ownerId)) return;
		Sockets.dispatch("requestRollDialogSync", { actorId: actor.id });
		if (dialog.rendered) dialog.render();
	});
}

/**
 * Flash the sacrifice banner on peer clients when a hero's roll dialog
 * transitions into sacrifice mode. The flag's `openedAt` is preserved
 * across type changes, so we track which (actorId, openedAt) we've already
 * announced — banner fires exactly once per arming, even though the flag
 * may be rewritten several times in a session.
 */
function _flashSacrificeBannerOnUpdate() {
	const announced = new Map(); // actorId → openedAt last announced
	Hooks.on("updateActor", (actor, changes) => {
		if (actor.type !== "hero") return;
		const flagPath = `flags.litmv2.${FLAGS.rollDialogOwner}`;
		if (!foundry.utils.hasProperty(changes, flagPath)) return;
		const flag = actor.getFlag("litmv2", FLAGS.rollDialogOwner);
		if (!flag) {
			announced.delete(actor.id);
			return;
		}
		if (flag.type !== "sacrifice") return;
		if (flag.ownerId === game.user.id) return;
		if (announced.get(actor.id) === flag.openedAt) return;
		announced.set(actor.id, flag.openedAt);
		// Modules can return false from `litm.sacrificePrepared` to suppress
		// the default banner (e.g. to replace it with their own treatment).
		if (Hooks.call("litm.sacrificePrepared", { actor }) === false) return;
		game.litmv2.showSacrificeBanner?.(actor.name);
	});
}
