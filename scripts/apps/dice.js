import { LitmSettings } from "../system/settings.js";

export class DoubleSix extends foundry.dice.terms.Die {
	constructor(termData) {
		super({ ...termData, faces: 12 });
	}

	static DENOMINATION = "6";

	get total() {
		const total = super.total;
		return Math.ceil(total / 2);
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
