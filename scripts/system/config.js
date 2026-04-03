export class LitmConfig {
	static BURN_POWER = 3;

	challenge_types = [
		"attacker",
		"barrier-hazard",
		"charge",
		"countdown",
		"mystery",
		"pursuer",
		"quarry",
		"temptation",
		"watcher",
	];

	vignette_types = ["block", "harm", "stress", "complication", "setback"];

	/**
	 * You can use this to completely override the default roll formula/resolver.
	 * formula: ({ totalPower }) => `${1 + Math.max(Math.abs(totalPower))}d6${totalPower < 1 ? `kl1` : "kh1"}`,
	 * resolver: (roll) => {
	 *    if (roll.dice[0].results.every(d => d.active && d.result === 1)) return { label: "failure", description: "Litm.ui.roll-failure" };
	 * }
	 * @link scripts/apps/roll-dialog.js
	 * @link scripts/apps/roll.js
	 */
	roll = { formula: null, resolver: null };

	theme_levels = {
		origin: [
			"circumstance",
			"past",
			"devotion",
			"mystery",
			"people",
			"possessions",
			"personality",
			"trade-or-skill",
			"trait",
			"hedge-magic",
		],
		adventure: [
			"prodigious-skill",
			"duty",
			"relic",
			"uncanny-being",
			"thaumaturgy",
		],
		greatness: [
			"rulership",
			"destiny",
			"mastery",
			"monstrosity",
			"grand-thaumaturgy",
		],
	};

	static #TAG_STRING_RE_SOURCE =
		String.raw`(?!\b|\s)(?:\[|\{)([^^\d[\]{}]+?)(?:([-:])(\d+)?)?(?:\}|\])`;
	static #TAG_STRING_RE_FLAGS = "gi";

	get tagStringRe() {
		return new RegExp(
			LitmConfig.#TAG_STRING_RE_SOURCE,
			LitmConfig.#TAG_STRING_RE_FLAGS,
		);
	}

	sceneLinkRe = /@ActivateScene\[([^\]]+)\](?:\{([^}]+)\})?/gi;

	assets = {
		logo: "systems/litmv2/assets/media/logo.svg",
		splash: "systems/litmv2/assets/media/litm_splash.webp",
		marshal_crest: "systems/litmv2/assets/media/marshal-crest.webp",
		icons: {
			base: "systems/litmv2/assets/media/icons/",
			backpack: "backpack.svg",
			fellowship: "fellowship.svg",
			trope: "book.svg",
			vignette: "cracked-skull.svg",
			addon: "cracked-skull.svg",
			default: "icons/svg/item-bag.svg",
		},
		preloads: [],
	};
}
