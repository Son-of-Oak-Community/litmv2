import { error } from "../../logger.js";
import { localize as t } from "../../utils.js";

export function registerActorHooks() {
	_prepareCharacterOnCreate();
	_validateFellowshipThemes();
	_enforceHeroItemLimits();
	_setStatusTagIcon();
	_validateEffectType();
}

function _prepareCharacterOnCreate() {
	Hooks.on("preCreateActor", (actor, data, _options, _userId) => {
		const tokenDefaults = {
			hero: {
				sight: { enabled: true },
				actorLink: true,
				disposition: foundry.CONST.TOKEN_DISPOSITIONS.FRIENDLY,
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
				return;
			}

			if (actor.type !== "journey") return;

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
 * Set icon and showIcon on story_tag and status_tag effects so they appear on tokens.
 */
function _setStatusTagIcon() {
	const icons = {
		story_tag: "systems/litmv2/assets/media/icons/unfurled-scroll.svg",
		status_tag: "systems/litmv2/assets/media/icons/consequences.svg",
	};
	Hooks.on("preCreateActiveEffect", (effect) => {
		const icon = icons[effect.type];
		if (!icon) return;
		effect.updateSource({
			img: icon,
			showIcon: foundry.CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
		});
	});
}

/**
 * Prevent incompatible effect types from being created on wrong parent documents.
 * Theme-bound tag effects belong on theme/story_theme items only.
 */
function _validateEffectType() {
	Hooks.on("preCreateActiveEffect", (effect) => {
		const themeTagTypes = new Set(["power_tag", "weakness_tag", "fellowship_tag"]);
		if (!themeTagTypes.has(effect.type)) return;
		const parent = effect.parent;
		if (parent?.documentName === "Item" && ["theme", "story_theme"].includes(parent.type)) return;
		ui.notifications.warn("LITM.Ui.warn_invalid_effect_target", { localize: true });
		return false;
	});
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
