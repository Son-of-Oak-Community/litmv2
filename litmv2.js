import {
	FellowshipTagData,
	PowerTagData,
	RelationshipTagData,
	StatusTagData,
	StoryTagData,
	WeaknessTagData,
} from "./modules/active-effects/index.js";
import { LitmActiveEffect } from "./modules/active-effects/litm-active-effect.js";
import { ChallengeData } from "./modules/actor/challenge/challenge-data.js";
import { FellowshipData } from "./modules/actor/fellowship/fellowship-data.js";
import { HeroData } from "./modules/actor/hero/hero-data.js";
import { JourneyData } from "./modules/actor/journey/journey-data.js";
import { LitmActor } from "./modules/actor/litm-actor.js";
import { StoryThemeActorData } from "./modules/actor/story-theme/story-theme-actor-data.js";
import { ApplyActionMenuApp } from "./modules/apps/apply-action-menu.js";
import { LitmCampingScene } from "./modules/apps/camping/camping-scene.js";
import { DoubleSix } from "./modules/apps/dice.js";
import { LitmRoll } from "./modules/apps/roll/roll.js";
import { LitmRollDialog } from "./modules/apps/roll/roll-dialog.js";
import { SpendPowerApp } from "./modules/apps/spend-power.js";
import { StoryTagSidebar } from "./modules/apps/story-tags/story-tag-sidebar.js";
import { ThemeAdvancementApp } from "./modules/apps/theme-advancement.js";
import { ThemeEvolutionWizard } from "./modules/apps/theme-evolution.js";
import { WelcomeOverlay } from "./modules/apps/welcome/welcome-overlay.js";
import { SuperCheckbox } from "./modules/components/super-checkbox.js";
import { LitmTokenHUD } from "./modules/hud/litm-token-hud.js";
import { ActionData } from "./modules/item/action/action-data.js";
import { AddonData } from "./modules/item/addon/addon-data.js";
import { BackpackData } from "./modules/item/backpack/backpack-data.js";
import { LitmItem } from "./modules/item/litm-item.js";
import { StoryThemeData } from "./modules/item/story-theme/story-theme-data.js";
import { ThemeData } from "./modules/item/theme/theme-data.js";
import { ThemebookData } from "./modules/item/themebook/themebook-data.js";
import { TropeData } from "./modules/item/trope/trope-data.js";
import { VignetteData } from "./modules/item/vignette/vignette-data.js";
import { info, success } from "./modules/logger.js";
import { LitmConfig } from "./modules/system/config.js";
import { ContentSources } from "./modules/system/content-sources.js";
import { Enrichers } from "./modules/system/enrichers.js";
import { Fonts } from "./modules/system/fonts.js";
import {
	HandlebarsHelpers,
	HandlebarsPartials,
} from "./modules/system/handlebars.js";
import { LitmHooks } from "./modules/system/hooks/index.js";
import { KeyBindings } from "./modules/system/keybindings.js";
import { migrateWorld } from "./modules/system/migrations.js";
import { LitmSettings } from "./modules/system/settings.js";
import { LitmSheets } from "./modules/system/sheets.js";
import { Sockets } from "./modules/system/sockets.js";

// Register Custom Elements
SuperCheckbox.Register();

// Init Hook
Hooks.once("init", () => {
	info("Initializing Legend in the Mist...");
	/**
	 * The litmv2 system's public surface, exposed for module authors and
	 * world-level macros. The system aims to be extensible/malleable —
	 * macros and modules may replace these classes (or subclass them) to
	 * change behaviour. See the "Extensibility" section in CLAUDE.md.
	 *
	 * - `data.*` — ActiveEffect data model classes
	 * - `methods.calculatePower` — kept for backward compat; prefer
	 *   `LitmRoll.calculatePower` directly
	 * - `fellowship` — the singleton fellowship actor (or null when disabled)
	 * - `LitmRoll`, `LitmRollDialog` — replaceable roll classes; combine with
	 *   `CONFIG.litmv2.roll.{formula,resolver}` for third-party roll customisation
	 * - `StoryTagApp`, `SpendPowerApp`, `ApplyActionMenuApp`,
	 *   `ThemeAdvancementApp`, `ThemeEvolutionWizard`, `WelcomeOverlay` —
	 *   replaceable app classes
	 * - `ContentSources` — compendium loading and status seeding entry point
	 * - `storyTags` — set at ready time to the sidebar tab instance
	 * - `rollDialogHud` — mutable reference to the active roll-dialog HUD
	 */
	game.litmv2 = {
		data: {
			PowerTagData,
			WeaknessTagData,
			FellowshipTagData,
			RelationshipTagData,
			StoryTagData,
			StatusTagData,
		},
		methods: {
			calculatePower: LitmRoll.calculatePower,
		},
		get fellowship() {
			if (!LitmSettings.useFellowship) return null;
			const id = LitmSettings.fellowshipId;
			return id ? (game.actors?.get(id) ?? null) : null;
		},
		LitmRollDialog,
		LitmRoll,
		WelcomeOverlay,
		StoryTagApp: StoryTagSidebar,
		SpendPowerApp,
		ApplyActionMenuApp,
		ThemeAdvancementApp,
		ThemeEvolutionWizard,
		LitmCampingScene,
		ContentSources,
		rollDialogHud: null,
	};

	info("Initializing Config...");
	CONFIG.Actor.dataModels.hero = HeroData;
	CONFIG.Actor.dataModels.challenge = ChallengeData;
	CONFIG.Actor.dataModels.journey = JourneyData;
	CONFIG.Actor.dataModels.fellowship = FellowshipData;
	CONFIG.Actor.dataModels.story_theme = StoryThemeActorData;
	CONFIG.Actor.trackableAttributes.hero = HeroData.getTrackableAttributes();
	LitmSettings.register();
	DoubleSix.register();
	CONFIG.Dice.rolls.push(LitmRoll);
	CONFIG.Actor.documentClass = LitmActor;
	CONFIG.Item.documentClass = LitmItem;
	CONFIG.ActiveEffect.documentClass = LitmActiveEffect;
	CONFIG.Item.dataModels.backpack = BackpackData;
	CONFIG.Item.dataModels.theme = ThemeData;
	CONFIG.Item.dataModels.themebook = ThemebookData;
	CONFIG.Item.dataModels.vignette = VignetteData;
	CONFIG.Item.dataModels.addon = AddonData;
	CONFIG.Item.dataModels.story_theme = StoryThemeData;
	CONFIG.Item.dataModels.trope = TropeData;
	CONFIG.Item.dataModels.action = ActionData;
	CONFIG.ActiveEffect.dataModels.power_tag = PowerTagData;
	CONFIG.ActiveEffect.dataModels.weakness_tag = WeaknessTagData;
	CONFIG.ActiveEffect.dataModels.fellowship_tag = FellowshipTagData;
	CONFIG.ActiveEffect.dataModels.relationship_tag = RelationshipTagData;
	CONFIG.ActiveEffect.dataModels.story_tag = StoryTagData;
	CONFIG.ActiveEffect.dataModels.status_tag = StatusTagData;
	CONFIG.ActiveEffect.typeLabels = {
		power_tag: "TYPES.ActiveEffect.power_tag",
		weakness_tag: "TYPES.ActiveEffect.weakness_tag",
		fellowship_tag: "TYPES.ActiveEffect.fellowship_tag",
		relationship_tag: "TYPES.ActiveEffect.relationship_tag",
		story_tag: "TYPES.ActiveEffect.story_tag",
		status_tag: "TYPES.ActiveEffect.status_tag",
	};
	CONFIG.litmv2 = LitmConfig;
	CONFIG.Token.hudClass = LitmTokenHUD;

	StoryTagSidebar.registerSidebarTab();

	LitmSheets.register();

	HandlebarsHelpers.register();
	HandlebarsPartials.register();
	Fonts.register();
	KeyBindings.register();
	LitmHooks.register();
});

// i18nInit Hook — needs localized strings
Hooks.once("i18nInit", () => {
	Enrichers.register();
});

// Ready Hook — needs game world + socket
Hooks.once("ready", async () => {
	await migrateWorld();
	await ContentSources.seedStatuses();
	await ContentSources.loadStatusCompendium();

	Sockets.registerListeners();
	LitmCampingScene.registerSocketHooks();

	// Alias game.litmv2.storyTags to the sidebar tab instance
	game.litmv2.storyTags = ui.combat;

	success("Successfully initialized Legend in the Mist!");
});
