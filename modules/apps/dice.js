import { LitmSettings } from "../system/settings.js";

/** A d6 has six pips; the themed die carries them twice. */
const PIPS = 6;

/**
 * The themed die: a d12 standing in for a d6. Its faces are labelled 1-5 and
 * F twice over (the Dice So Nice preset in `compat-hooks.js`), so face 7
 * shows a 1. What the roll counts is what the die on the table shows, which
 * makes two of them 2d6.
 */
export class DoubleSix extends foundry.dice.terms.Die {
	constructor(termData) {
		super({ ...termData, faces: 12 });
	}

	static DENOMINATION = "6";

	/**
	 * The pip a rolled face shows.
	 * @param {number} face  The d12 face, 1-12
	 * @returns {number}     1-6
	 */
	static pip(face) {
		return ((face - 1) % PIPS) + 1;
	}

	/**
	 * Whether this term counts pips. A term rolled before it did halved the
	 * sum of its raw faces instead; a chat card re-renders from the stored
	 * term on every load, so such a term keeps the reading it was rolled
	 * with and an old card keeps its outcome.
	 * @type {boolean}
	 */
	get countsPips() {
		return this.options.pips === true;
	}

	/** @override */
	_evaluate(options = {}) {
		// `options` is serialized with the term, so the stamp travels with
		// the chat message.
		this.options.pips = true;
		return super._evaluate(options);
	}

	/** @override */
	get total() {
		if (!this._evaluated) return undefined;
		if (!this.countsPips) return Math.ceil(super.total / 2);
		let total = this.results.reduce((sum, r) => {
			if (!r.active) return sum;
			if (r.count !== undefined) return sum + r.count;
			return sum + DoubleSix.pip(r.result);
		}, 0);
		if (this.number < 0) total *= -1;
		return total;
	}

	/** @override */
	getResultLabel(result) {
		if (!this.countsPips) return super.getResultLabel(result);
		return String(DoubleSix.pip(result.result));
	}

	/** @override */
	getResultCSS(result) {
		if (!this.countsPips) return super.getResultCSS(result);
		// Foundry marks the lowest and highest *face*; a 7 is this die's 1.
		const pip = DoubleSix.pip(result.result);
		const scored = result.success !== undefined || result.failure !== undefined;
		return super
			.getResultCSS(result)
			.filter((cls) => cls !== "min" && cls !== "max")
			.concat(
				!scored && pip === 1 ? "min" : null,
				!scored && pip === PIPS ? "max" : null,
			);
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
