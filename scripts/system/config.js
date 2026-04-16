/** All theme-bound tag effect types (power, weakness, fellowship). */
export const THEME_TAG_TYPES = new Set(["power_tag", "weakness_tag", "fellowship_tag"]);

/** Power-side theme tag types only (excludes weakness). */
export const POWER_TAG_TYPES = new Set(["power_tag", "fellowship_tag"]);

/** Effect types that live directly on actors (not on theme items). */
export const ACTOR_TAG_TYPES = new Set(["story_tag", "status_tag"]);

/** Effect types that support the ScratchableMixin. */
export const SCRATCHABLE_TAG_TYPES = new Set(["power_tag", "fellowship_tag", "story_tag", "relationship_tag"]);

/** All effect type string identifiers. */
export const EFFECT_TYPES = Object.freeze({
	power_tag: "power_tag",
	weakness_tag: "weakness_tag",
	fellowship_tag: "fellowship_tag",
	relationship_tag: "relationship_tag",
	story_tag: "story_tag",
	status_tag: "status_tag",
});

/**
 * Maps effect type to its default localization key for group display.
 * `null` means the label is context-dependent (e.g., story_tag uses backpack name).
 */
export const EFFECT_GROUP_LABELS = Object.freeze({
	power_tag: "LITM.Terms.power_tags",
	weakness_tag: "LITM.Terms.weakness_tags",
	fellowship_tag: "LITM.Terms.fellowship_tags",
	relationship_tag: "LITM.Terms.relationship",
	story_tag: null,
	status_tag: "LITM.Terms.statuses",
});

/** Canonical ordering of effect types for display sorting. */
export const EFFECT_TAG_ORDER = Object.freeze({
	power_tag: 1,
	fellowship_tag: 2,
	weakness_tag: 3,
	relationship_tag: 4,
	story_tag: 5,
	status_tag: 6,
});

/** All actor document types in this system. */
export const ACTOR_TYPES = {
	hero: "hero",
	challenge: "challenge",
	journey: "journey",
	fellowship: "fellowship",
	story_theme: "story_theme",
};

/** All item document types in this system. */
export const ITEM_TYPES = {
	theme: "theme",
	themebook: "themebook",
	trope: "trope",
	backpack: "backpack",
	story_theme: "story_theme",
	vignette: "vignette",
	addon: "addon",
};

/** Actor types that store limits in flags rather than system.limits. */
export const FLAG_LIMIT_TYPES = new Set(["hero", "fellowship", "journey"]);

export const BURN_POWER = 3;

export const ITEM_DEFAULT_ICONS = {
	addon: "systems/litmv2/assets/media/icons/rating.svg",
	vignette: "systems/litmv2/assets/media/icons/consequences.svg",
	backpack: "systems/litmv2/assets/media/icons/backpack.svg",
	trope: "icons/svg/target.svg",
};

/** Localization keys for might level options (shared by challenge + addon sheets). */
export const MIGHT_OPTIONS = {
	adventure: "LITM.Terms.adventure",
	greatness: "LITM.Terms.greatness",
};

/** Maps effect type → CSS variable name for the accent color. */
export const EFFECT_TYPE_COLORS = {
	power_tag: "--color-litm-tag",
	weakness_tag: "--color-litm-weakness",
	fellowship_tag: "--color-litm-tag",
	relationship_tag: "--color-litm-tag",
	story_tag: "--color-litm-tag",
	status_tag: "--color-litm-status",
};

/** All valid theme level keys, derived from the mutable LitmConfig.theme_levels. */
export function getThemeLevels() {
	return Object.keys(LitmConfig.theme_levels);
}

/** The default (first) theme level key. */
export function getDefaultThemeLevel() {
	return Object.keys(LitmConfig.theme_levels)[0];
}

export const ROLL_TYPES = {
	quick: {
		flavor: () => "LITM.Ui.roll_quick",
		effect: () => null,
		hasPower: false,
		outcome: null,
	},
	tracked: {
		flavor: () => "LITM.Ui.roll_tracked",
		effect: () => null,
		hasPower: true,
		outcome: null,
	},
	mitigate: {
		flavor: () => "LITM.Ui.roll_mitigate",
		effect: () => ({
			action: "LITM.Effects.mitigate.action",
			description: "LITM.Effects.mitigate.description",
			cost: "LITM.Effects.mitigate.cost",
		}),
		hasPower: true,
		outcome: null,
	},
	sacrifice: {
		flavor: (roll) => {
			const levelKey = roll.litm.sacrificeLevel || "painful";
			return `LITM.Ui.sacrifice_${levelKey} LITM.Ui.roll_sacrifice`;
		},
		effect: () => null,
		hasPower: false,
		outcome: (roll) => {
			if (roll.total >= 10) {
				return { label: "success", description: "LITM.Ui.roll_sacrifice_success" };
			}
			if (roll.total >= 7) {
				return { label: "snc", description: "LITM.Ui.roll_sacrifice_mixed" };
			}
			return { label: "consequences", description: "LITM.Ui.roll_sacrifice_failure" };
		},
	},
};

const TAG_STRING_RE_SOURCE =
	String.raw`(?!\b|\s)(?:\[|\{)([^^\d[\]{}]+?)(?:([-:])(\d+)?)?(?:\}|\])`;
const TAG_STRING_RE_FLAGS = "gi";

/** Create a fresh tag-string regex (g flag requires new instance per use). */
export function makeTagStringRe() {
	return new RegExp(TAG_STRING_RE_SOURCE, TAG_STRING_RE_FLAGS);
}

/**
 * Instance-based config stored as CONFIG.litmv2.
 * Contains mutable, world-customizable values.
 */
export const LitmConfig = {
	challenge_types: [
		"attacker",
		"barrier-hazard",
		"charge",
		"countdown",
		"mystery",
		"pursuer",
		"quarry",
		"temptation",
		"watcher",
	],

	vignette_types: ["block", "harm", "stress", "complication", "setback"],

	/**
	 * You can use this to completely override the default roll formula/resolver.
	 * @link scripts/apps/roll-dialog.js
	 * @link scripts/apps/roll.js
	 */
	roll: { formula: null, resolver: null },

	theme_levels: {
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
	},

	get tagStringRe() {
		return makeTagStringRe();
	},

	sceneLinkRe: /@ActivateScene\[([^\]]+)\](?:\{([^}]+)\})?/gi,

	assets: {
		logo: "systems/litmv2/assets/media/logo.svg",
		splash: "systems/litmv2/assets/media/litm_splash.webp",
		marshal_crest: "systems/litmv2/assets/media/marshal-crest.webp",
		icons: {
			base: "systems/litmv2/assets/media/icons/",
			backpack: "backpack.svg",
			fellowship: "fellowship.svg",
			trope: "book.svg",
			vignette: "consequences.svg",
			addon: "rating.svg",
			default: "icons/svg/item-bag.svg",
			defaultActor: "icons/svg/mystery-man.svg",
		},
		preloads: [],
	},
};
