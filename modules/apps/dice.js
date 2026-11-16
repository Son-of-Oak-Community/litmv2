import { LitmSettings } from "../system/settings.js";

/**
 * A legacy term: a d12 that counted as half its faces, standing in for a d6.
 *
 * No roll made on Foundry v14 builds it. The roll parser reads the `6` in
 * `2d6` as a number of faces and never looks a numeric face count up as a
 * denomination, so `2d6` is a plain six-sided `Die` and the themed look is
 * the Dice So Nice preset alone (`compat-hooks.js`).
 *
 * It stays registered for the chat messages older versions stored. A card
 * re-renders from its stored term, which names this class; without it those
 * cards would read their raw d12 faces and change their totals.
 */
export class DoubleSix extends foundry.dice.terms.Die {
	constructor(termData) {
		super({ ...termData, faces: 12 });
	}

	static DENOMINATION = "6";

	/** @override */
	get total() {
		if (!this._evaluated) return undefined;
		return Math.ceil(super.total / 2);
	}

	/**
	 * Register the DoubleSix die term if the custom dice setting is enabled.
	 */
	static register() {
		if (LitmSettings.customDice) {
			CONFIG.Dice.terms[DoubleSix.DENOMINATION] = DoubleSix;
		}
	}
}
