import { ContentSourcesConfig } from "../apps/content-sources-config.js";
import { LitmConfig } from "./config.js";
import { ContentSources } from "./content-sources.js";

export class LitmSettings {
	static get popoutTagsSidebar() {
		return game.settings.get("litmv2", "popout_tags_sidebar");
	}

	static get partyOverviewShowAll() {
		return game.settings.get("litmv2", "party_overview_show_all");
	}

	static setPartyOverviewShowAll(v) {
		return game.settings.set("litmv2", "party_overview_show_all", v);
	}

	static get welcomed() {
		return game.settings.get("litmv2", "welcomed");
	}

	static setWelcomed(v) {
		return game.settings.set("litmv2", "welcomed", v);
	}

	static get storyTags() {
		return game.settings.get("litmv2", "storytags");
	}

	/**
	 * @param {T} v Value
	 * @returns {Promise<T>}
	 */
	static setStoryTags(v) {
		return game.settings.set("litmv2", "storytags", v);
	}

	static get customDice() {
		return game.settings.get("litmv2", "custom_dice");
	}

	static get colorblindMode() {
		return game.settings.get("litmv2", "colorblind_mode");
	}

	static get systemMigrationVersion() {
		return game.settings.get("litmv2", "systemMigrationVersion");
	}

	static setSystemMigrationVersion(v) {
		return game.settings.set("litmv2", "systemMigrationVersion", v);
	}

	/**
	 * Upper bound for the Hero Limit setting. Not a rules value — status
	 * tracks grow to `heroLimit + 1` (see `CONFIG.litmv2.maxStatusTier`), so
	 * this only keeps the deepest homebrew track at a renderable ten boxes.
	 * @type {number}
	 */
	static #MAX_HERO_LIMIT = 9;

	/**
	 * The world's Hero Limit: the status tier at which a hero is overcome.
	 * Clamped on read so a value stored outside the setting's range — by an
	 * older range, a macro, or a module — can't produce an untrackable limit.
	 * @returns {number}
	 */
	static get heroLimit() {
		const stored = game.settings.get("litmv2", "hero_limit");
		return LitmSettings.#clampHeroLimit(stored);
	}

	static #clampHeroLimit(value) {
		const n = Number(value);
		if (!Number.isFinite(n)) return 5;
		return Math.max(1, Math.min(LitmSettings.#MAX_HERO_LIMIT, Math.round(n)));
	}

	static get themeLimit() {
		return game.settings.get("litmv2", "theme_limit");
	}

	static get improveThreshold() {
		return game.settings.get("litmv2", "improve_threshold");
	}

	static get autoMarkImprove() {
		return game.settings.get("litmv2", "auto_mark_improve");
	}

	static get useFellowship() {
		return game.settings.get("litmv2", "use_fellowship");
	}

	static get showCampingThreats() {
		return game.settings.get("litmv2", "show_camping_threats");
	}

	static get fellowshipId() {
		return game.settings.get("litmv2", "fellowshipId");
	}

	static setFellowshipId(v) {
		return game.settings.set("litmv2", "fellowshipId", v);
	}

	static get statusesSeeded() {
		return game.settings.get("litmv2", "statusesSeeded");
	}

	static setStatusesSeeded(v) {
		return game.settings.set("litmv2", "statusesSeeded", v);
	}

	static getCompendiumSetting(category) {
		return game.settings.get("litmv2", `compendium.${category}`);
	}

	static setCompendiumSetting(category, value) {
		return game.settings.set("litmv2", `compendium.${category}`, value);
	}

	static register() {
		game.settings.registerMenu("litmv2", "contentSources", {
			name: "LITM.Settings.content_sources",
			hint: "LITM.Settings.content_sources_hint",
			label: "LITM.Settings.content_sources_label",
			icon: "fas fa-atlas",
			type: ContentSourcesConfig,
			restricted: true,
		});

		game.settings.register("litmv2", "compendium.themebooks", {
			scope: "world",
			config: false,
			type: Array,
			default: [],
		});
		game.settings.register("litmv2", "compendium.themekits", {
			scope: "world",
			config: false,
			type: Array,
			default: [],
		});
		game.settings.register("litmv2", "compendium.tropes", {
			scope: "world",
			config: false,
			type: Array,
			default: [],
		});
		game.settings.register("litmv2", "compendium.statuses", {
			scope: "world",
			config: false,
			type: Array,
			default: [],
			// The item categories are read live by their pickers, but
			// CONFIG.statusEffects is only built at `ready`. Rebuild it in place
			// on every client when the selection changes, so status sources apply
			// without a world reload.
			onChange: () => ContentSources.loadStatusCompendium(),
		});
		game.settings.register("litmv2", "statusesSeeded", {
			scope: "world",
			config: false,
			type: Boolean,
			default: false,
		});

		game.settings.register("litmv2", "welcomed", {
			name: "LITM.Settings.welcome_screen",
			hint: "Welcome Scene, Message, and Journal Entry has been created and displayed.",
			scope: "world",
			config: false,
			type: Boolean,
			default: false,
		});

		game.settings.register("litmv2", "storytags", {
			name: "LITM.Settings.story_tags",
			hint: "Sidebar configuration: tracked actors, limits, and visibility.",
			scope: "world",
			config: false,
			type: Object,
			default: {
				actors: [],
				limits: [],
			},
		});
		game.settings.register("litmv2", "systemMigrationVersion", {
			name: "System Migration Version",
			scope: "world",
			config: false,
			type: Number,
			default: -1,
		});
		game.settings.register("litmv2", "fellowshipId", {
			name: "Fellowship Actor ID",
			scope: "world",
			config: false,
			type: String,
			default: "",
		});
		game.settings.register("litmv2", "hero_limit", {
			name: "LITM.Settings.hero_limit",
			hint: "LITM.Settings.hero_limit_hint",
			scope: "world",
			config: true,
			type: Number,
			default: 5,
			range: { min: 1, max: LitmSettings.#MAX_HERO_LIMIT, step: 1 },
			requiresReload: true,
			onChange: (value) => {
				CONFIG.litmv2.heroLimit = LitmSettings.#clampHeroLimit(value);
			},
		});
		game.settings.register("litmv2", "theme_limit", {
			name: "LITM.Settings.theme_limit",
			hint: "LITM.Settings.theme_limit_hint",
			scope: "world",
			config: true,
			type: Number,
			default: 4,
			range: { min: 1, max: 10, step: 1 },
			requiresReload: true,
			onChange: (value) => {
				CONFIG.litmv2.themeLimit = value;
			},
		});
		// Seeded here (init) rather than on `ready` — documents prepare their
		// data before `ready`, and both values are read during preparation:
		// `heroLimit` sets the hero's limit readout *and* the status track
		// depth (`CONFIG.litmv2.maxStatusTier`), which decides how many boxes
		// every status has. Seeding late left the first render of a world on
		// the defaults until each document happened to be updated.
		LitmConfig.heroLimit = LitmSettings.heroLimit;
		LitmConfig.themeLimit = LitmSettings.themeLimit;
		game.settings.register("litmv2", "improve_threshold", {
			name: "LITM.Settings.improve_threshold",
			hint: "LITM.Settings.improve_threshold_hint",
			scope: "world",
			config: true,
			type: Number,
			default: 3,
			range: { min: 1, max: 6, step: 1 },
			requiresReload: true,
			onChange: (value) => {
				CONFIG.litmv2.improveThreshold = value;
			},
		});
		// The ThemeData schema reads this for the improve track's `max` when it
		// is first built (during setup, before ready) — mirror it now rather
		// than in ready-hooks like heroLimit/themeLimit.
		LitmConfig.improveThreshold = LitmSettings.improveThreshold;
		game.settings.register("litmv2", "auto_mark_improve", {
			name: "LITM.Settings.auto_mark_improve",
			hint: "LITM.Settings.auto_mark_improve_hint",
			scope: "world",
			config: true,
			type: Boolean,
			default: true,
			requiresReload: true,
		});
		game.settings.register("litmv2", "use_fellowship", {
			name: "LITM.Settings.use_fellowship",
			hint: "LITM.Settings.use_fellowship_hint",
			scope: "world",
			config: true,
			type: Boolean,
			default: true,
			requiresReload: true,
		});
		game.settings.register("litmv2", "show_camping_threats", {
			name: "LITM.Settings.show_camping_threats",
			hint: "LITM.Settings.show_camping_threats_hint",
			scope: "world",
			config: true,
			type: Boolean,
			default: true,
		});
		game.settings.register("litmv2", "custom_dice", {
			name: "LITM.Settings.custom_dice",
			hint: "LITM.Settings.custom_dice_hint",
			scope: "client",
			config: true,
			type: Boolean,
			default: true,
			requiresReload: true,
		});
		game.settings.register("litmv2", "popout_tags_sidebar", {
			name: "LITM.Settings.popout_tags_sidebar",
			hint: "LITM.Settings.popout_tags_sidebar_hint",
			scope: "client",
			config: true,
			type: Boolean,
			default: false,
		});
		game.settings.register("litmv2", "colorblind_mode", {
			name: "LITM.Settings.colorblind_mode",
			hint: "LITM.Settings.colorblind_mode_hint",
			scope: "client",
			config: true,
			type: Boolean,
			default: false,
			onChange: (v) => {
				document.body.classList.toggle("litm--colorblind", !!v);
			},
		});
		game.settings.register("litmv2", "party_overview_show_all", {
			scope: "client",
			config: false,
			type: Boolean,
			default: false,
		});
	}
}
