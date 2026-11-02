import { weaknessTagEffect } from "../active-effects/effect-factories.js";
import { getDefaultThemeLevel, POWER_TAG_TYPES } from "../system/config.js";
import { localize as t } from "../utils.js";

/**
 * Re-shape an existing theme from a template: a theme kit (any `theme`
 * item) or a themebook. The theme keeps its id and its title tag, which
 * the item-hooks rename sync renames along with the theme. Shared by the
 * evolution wizard's replace (which adds Promise and the nascent-theme
 * bookkeeping on top) and by setting a Hero up from the theme browser,
 * which does neither.
 */

/**
 * Delete every non-title power tag and every weakness tag from the theme,
 * and clear the surviving title tag's question pointer.
 * @param {Item} theme
 */
export async function wipeNonTitleTagEffects(theme) {
	const wipeIds = [...theme.effects]
		.filter(
			(e) =>
				(POWER_TAG_TYPES.has(e.type) && !e.system.isTitleTag) ||
				e.type === "weakness_tag",
		)
		.map((e) => e.id);
	if (wipeIds.length) {
		await theme.deleteEmbeddedDocuments("ActiveEffect", wipeIds);
	}
	// The surviving title tag still carries the OLD themebook's question
	// index — reset it so the new theme starts with a clean slot. The
	// title tag's name is updated by the item-hooks rename-sync; only its
	// question pointer needs zeroing.
	const titleTag = [...theme.effects].find(
		(e) => POWER_TAG_TYPES.has(e.type) && e.system?.isTitleTag,
	);
	if (titleTag && titleTag.system?.question != null) {
		await theme.updateEmbeddedDocuments("ActiveEffect", [
			{ _id: titleTag.id, "system.question": null },
		]);
	}
}

/**
 * The theme update that copies a kit: name, themebook, level, description,
 * quest and specials, with the quest tracks reset.
 * @param {Item} kit  A `theme` item
 * @returns {object}
 */
export function kitThemeUpdate(kit) {
	return {
		name: kit.name,
		"system.themebook": kit.system?.themebook ?? "",
		"system.level": kit.system?.level || getDefaultThemeLevel(),
		"system.description": kit.system?.description ?? "",
		"system.quest.description": kit.system?.quest?.description ?? "",
		"system.quest.tracks.milestone.value": 0,
		"system.quest.tracks.abandon.value": 0,
		"system.specialImprovements": foundry.utils.deepClone(
			kit.system?.specialImprovements ?? [],
		),
	};
}

/**
 * Creation data for a kit's power and weakness tags. The title tag stays
 * on the target theme, so the kit's own is not copied.
 * @param {Item} kit
 * @returns {object[]}
 */
export function kitTagEffects(kit) {
	const toCreate = [];
	for (const eff of kit.effects) {
		const isPower = POWER_TAG_TYPES.has(eff.type) && !eff.system?.isTitleTag;
		const isWeakness = eff.type === "weakness_tag";
		if (!isPower && !isWeakness) continue;
		const obj = eff.toObject();
		delete obj._id;
		toCreate.push(obj);
	}
	return toCreate;
}

/**
 * The theme update for a themebook: the theme takes the book's name and
 * type, and its Might when the book fixes one. A variable book keeps the
 * theme's current Might.
 * @param {Item} book   A `themebook` item
 * @param {Item} theme  The theme being re-shaped
 * @returns {object}
 */
export function themebookThemeUpdate(book, theme) {
	const fixed = book.system?.theme_level;
	return {
		name: book.name,
		"system.themebook": book.name,
		"system.level":
			fixed && fixed !== "variable"
				? fixed
				: theme.system?.level || getDefaultThemeLevel(),
		"system.description": "",
		"system.quest.description": "",
		"system.quest.tracks.milestone.value": 0,
		"system.quest.tracks.abandon.value": 0,
		"system.specialImprovements": [],
	};
}

/**
 * Set a theme up from a kit or a themebook, with no evolution bookkeeping:
 * no Promise, no nascent-theme counter, no `litm.themeAdvanced`. A kit's
 * tags are copied; a themebook has none, so the theme gets the same
 * placeholder weakness a Replace gives, for the player to rewrite.
 * @param {{theme: Item, source: Item}} options
 * @returns {Promise<boolean>} False when the kinds don't match and nothing
 *   changed
 */
export async function applyThemeTemplate({ theme, source }) {
	if (!!source.system?.isFellowship !== !!theme.system?.isFellowship) {
		ui.notifications?.warn(t("LITM.Ui.evolution_drop_theme_kind_mismatch"));
		return false;
	}
	const isKit = source.type === "theme";
	// Read the source before the target is touched, in case they share effects.
	const effects = isKit
		? kitTagEffects(source)
		: [
				weaknessTagEffect({
					name: t("LITM.Ui.evolution_new_weakness_placeholder"),
					isActive: true,
				}),
			];
	const update = {
		...(isKit ? kitThemeUpdate(source) : themebookThemeUpdate(source, theme)),
		"system.improve.value": 0,
	};
	await wipeNonTitleTagEffects(theme);
	await theme.update(update);
	if (effects.length) {
		await theme.createEmbeddedDocuments("ActiveEffect", effects);
	}
	return true;
}
