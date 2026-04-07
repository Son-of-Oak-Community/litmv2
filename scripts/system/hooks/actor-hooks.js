import { error } from "../../logger.js";
import { THEME_TAG_TYPES } from "../config.js";
import { localize as t } from "../../utils.js";

export function registerActorHooks() {
	_prepareCharacterOnCreate();
	_validateFellowshipThemes();
	_enforceHeroItemLimits();
	_validateEffectType();
	_syncUiOnEffectChange();
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
			if (actor.img === "icons/svg/mystery-man.svg") {
				actor.updateSource({
					img: "systems/litmv2/assets/media/icons/fellowship.svg",
				});
			}
		}
	});

	Hooks.on("createActor", (actor, options) => {
		(async () => {
			if (!game.user.isGM) return;

			if (actor.type === "story_theme") {
				const hasTheme = actor.items.some((i) => i.type === "story_theme");
				if (!hasTheme) {
					await actor.createEmbeddedDocuments("Item", [
						{ name: actor.name, type: "story_theme" },
					]);
				}
				return;
			}

			if (actor.type === "hero") {
				if (options?.litm?.skipAutoSetup) return;
				const missingThemes = Math.max(
					4 - actor.items.filter((it) => it.type === "theme").length,
					0,
				);

				if (missingThemes > 0) {
					const themeItems = Array(missingThemes)
						.fill()
						.map((_, i) => ({
							name: `${t("TYPES.Item.theme")} ${i + 1}`,
							type: "theme",
						}));
					await actor.createEmbeddedDocuments("Item", themeItems);
				}
				const backpack = actor.items.find((it) => it.type === "backpack");
				if (!backpack) {
					await actor.createEmbeddedDocuments("Item", [
						{
							name: t("TYPES.Item.backpack"),
							type: "backpack",
						},
					]);
				}
			} else if (actor.type === "journey") {
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
			}

			// Open the sheet in edit mode for newly created actors
			if (actor.isOwner) actor.sheet.render(true, { mode: 1 });
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

		const existingFellowship = actor.items.find(
			(i) => i.type === "theme" && i.system.isFellowship,
		);

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
		if (parent.documentName === "Item" && ["theme", "story_theme"].includes(parent.type)) return;
		ui.notifications.warn("LITM.Ui.warn_invalid_effect_target", { localize: true });
		return false;
	});
}

/**
 * Re-render all tag-aware UI (sidebar, roll dialogs, hero sheets) when effects change.
 * Centralized here so the HUD, sidebar, macros, etc. don't each need their own hooks.
 */
function _syncUiOnEffectChange() {
	const TAG_TYPES = new Set(["status_tag", "story_tag"]);
	const sync = (effect) => {
		if (!TAG_TYPES.has(effect.type)) return;
		// Sidebar
		const sidebar = ui.combat;
		if (sidebar) {
			sidebar.invalidateCache();
			sidebar.render();
			sidebar.refreshRollDialogs();
		}
		// Actor sheet — find the owning actor and re-render
		const actor = effect.parent?.documentName === "Actor"
			? effect.parent
			: effect.parent?.parent;
		if (actor?.sheet?.rendered) actor.sheet.render();
	};
	Hooks.on("createActiveEffect", sync);
	Hooks.on("updateActiveEffect", sync);
	Hooks.on("deleteActiveEffect", sync);
}

function _enforceHeroItemLimits() {
	Hooks.on("preCreateItem", (item, _data, _options, _userId) => {
		const actor = item.parent;
		if (!actor || actor.type !== "hero") return;

		if (item.type === "theme" && !item.system?.isFellowship) {
			const regularThemes = actor.items.filter(
				(i) => i.type === "theme" && !i.system.isFellowship,
			);
			if (regularThemes.length >= 4) {
				ui.notifications.warn(game.i18n.localize("LITM.Ui.warn_theme_limit"));
				return false;
			}
		}

		if (item.type === "backpack") {
			const backpacks = actor.items.filter((i) => i.type === "backpack");
			if (backpacks.length >= 1) {
				ui.notifications.warn(
					game.i18n.localize("LITM.Ui.warn_backpack_limit"),
				);
				return false;
			}
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
 */
function _syncStoryThemeActorToItem() {
	Hooks.on("updateActor", (actor, data) => {
		if (actor.type !== "story_theme") return;
		const theme = actor.items.find((i) => i.type === "story_theme");
		if (!theme) return;

		const updates = {};
		if ("name" in data && theme.name !== data.name) updates.name = data.name;
		if ("img" in data && theme.img !== data.img) updates.img = data.img;
		if (Object.keys(updates).length) theme.update(updates);
	});
}
