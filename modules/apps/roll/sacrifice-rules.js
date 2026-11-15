/**
 * Pure rules helpers for the Sacrifice roll flow.
 *
 * No DOM or Foundry-document mutation; safe to unit-test. The roll dialog
 * (roll-dialog.js) glues these to documents and the UI. A Painful sacrifice
 * scratches a theme's power tags, so "spent-ness" — whether anything is left to
 * scratch — gates which themes are valid Painful targets. Scarring/Grave act on
 * the whole theme (or a status), so spent-ness is irrelevant for them.
 */

import { POWER_TAG_TYPES } from "../../system/config.js";

/**
 * A theme is "spent" when every non-disabled power-type tag on it (power_tag /
 * fellowship_tag, including the title tag) is already scratched. A Painful
 * sacrifice scratches those tags, so a spent theme offers nothing.
 * @param {Item} theme
 * @returns {boolean}
 */
export function isThemeSpent(theme) {
	if (!theme) return false;
	const powerLike = [...theme.effects].filter(
		(e) => POWER_TAG_TYPES.has(e.type) && !e.disabled,
	);
	return powerLike.length > 0 && powerLike.every((e) => e.system?.isScratched);
}

/**
 * Whether a Painful sacrifice has at least one valid target among `themes` —
 * i.e. a theme that still has an unscratched power tag. When every theme is
 * spent a Painful sacrifice would scratch nothing.
 * @param {Item[]} themes
 * @returns {boolean}
 */
export function hasPainfulSacrificeTarget(themes) {
	return themes.some((theme) => !isThemeSpent(theme));
}

/**
 * The price of a sacrifice once the roll is in — a Miracle ("success") lessens
 * it by one level, Fate and In Vain pay it in full (Core Book p.159). A lessened
 * Painful scratches one tag instead of every tag: "painfulOne".
 * @param {"painful"|"scarring"|"grave"} level
 * @param {"success"|"snc"|"consequences"} outcomeLabel
 * @returns {"painfulOne"|"painful"|"scarring"|"grave"}
 */
export function effectiveSacrificeLevel(level, outcomeLabel) {
	if (outcomeLabel !== "success") return level;
	if (level === "grave") return "scarring";
	if (level === "scarring") return "painful";
	return "painfulOne";
}

/**
 * Whether a Sacrifice at `level` may name a story theme. Only Painful: a story
 * theme's tags can be scratched (Core Book p.159), but it has no Quest or
 * Promise to replace it by (p.192), and a Grave Miracle lessens to Scarring.
 * @param {"painful"|"scarring"|"grave"} level
 * @returns {boolean}
 */
export function storyThemeMaySacrifice(level) {
	return level === "painful";
}
