export class LitmSettings {
	static get popoutTagsSidebar() {
		return game.settings.get("litmv2", "popout_tags_sidebar");
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

	static setStoryTags(v) {
		return game.settings.set("litmv2", "storytags", v);
	}

	static get customDice() {
		return game.settings.get("litmv2", "custom_dice");
	}

	static get systemMigrationVersion() {
		return game.settings.get("litmv2", "systemMigrationVersion");
	}

	static setSystemMigrationVersion(v) {
		return game.settings.set("litmv2", "systemMigrationVersion", v);
	}

	static get heroLimit() {
		return game.settings.get("litmv2", "hero_limit");
	}

	static get useFellowship() {
		return game.settings.get("litmv2", "use_fellowship");
	}

	static get fellowshipId() {
		return game.settings.get("litmv2", "fellowshipId");
	}

	static setFellowshipId(v) {
		return game.settings.set("litmv2", "fellowshipId", v);
	}

	static register() {
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
			hint: "Tags that are shared between all users.",
			scope: "world",
			config: false,
			type: Object,
			default: {
				tags: [],
				actors: [],
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
			range: { min: 1, max: 10, step: 1 },
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
	}
}
