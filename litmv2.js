import { ChallengeData } from "./scripts/actor/challenge/challenge-data.js";
import { ChallengeSheet } from "./scripts/actor/challenge/challenge-sheet.js";
import { FellowshipData } from "./scripts/actor/fellowship/fellowship-data.js";
import { FellowshipSheet } from "./scripts/actor/fellowship/fellowship-sheet.js";
import { HeroData } from "./scripts/actor/hero/hero-data.js";
import { HeroSheet } from "./scripts/actor/hero/hero-sheet.js";
import { JourneyData } from "./scripts/actor/journey/journey-data.js";
import { JourneySheet } from "./scripts/actor/journey/journey-sheet.js";
import { StoryThemeActorData } from "./scripts/actor/story-theme/story-theme-actor-data.js";
import { StoryThemeActorSheet } from "./scripts/actor/story-theme/story-theme-actor-sheet.js";
import { DoubleSix } from "./scripts/apps/dice.js";
import { LitmRoll } from "./scripts/apps/roll.js";
import { LitmRollDialog } from "./scripts/apps/roll-dialog.js";
import { SpendPowerApp } from "./scripts/apps/spend-power.js";
import { StoryTagSidebar } from "./scripts/apps/story-tag-sidebar.js";
import { ThemeAdvancementApp } from "./scripts/apps/theme-advancement.js";
import { WelcomeOverlay } from "./scripts/apps/welcome-overlay.js";
import { SuperCheckbox } from "./scripts/components/super-checkbox.js";
import { LitmTokenHUD } from "./scripts/hud/litm-token-hud.js";
import {
	PowerTagData,
	WeaknessTagData,
	FellowshipTagData,
	RelationshipTagData,
	StoryTagData,
	StatusTagData,
} from "./scripts/data/active-effects/index.js";
import { LitmActiveEffect } from "./scripts/data/active-effects/litm-active-effect.js";
import { LitmActiveEffectSheet } from "./scripts/data/active-effects/active-effect-sheet.js";
import { BackpackData } from "./scripts/item/backpack/backpack-data.js";
import { BackpackSheet } from "./scripts/item/backpack/backpack-sheet.js";
import { LitmItem } from "./scripts/item/litm-item.js";
import { StoryThemeData } from "./scripts/item/story-theme/story-theme-data.js";
import { StoryThemeSheet } from "./scripts/item/story-theme/story-theme-sheet.js";
import { ThemeData } from "./scripts/item/theme/theme-data.js";
import { ThemeSheet } from "./scripts/item/theme/theme-sheet.js";
import { ThemebookData } from "./scripts/item/themebook/themebook-data.js";
import { ThemebookSheet } from "./scripts/item/themebook/themebook-sheet.js";
import { TropeData } from "./scripts/item/trope/trope-data.js";
import { TropeSheet } from "./scripts/item/trope/trope-sheet.js";
import { VignetteData } from "./scripts/item/vignette/vignette-data.js";
import { VignetteSheet } from "./scripts/item/vignette/vignette-sheet.js";
import { AddonData } from "./scripts/item/addon/addon-data.js";
import { AddonSheet } from "./scripts/item/addon/addon-sheet.js";
import { info, success } from "./scripts/logger.js";
import {
	ChallengeSheetLandscape,
	FellowshipSheetLandscape,
	HeroSheetLandscape,
	JourneySheetLandscape,
} from "./scripts/sheets/landscape-sheets.js";
import { LitmConfig } from "./scripts/system/config.js";
import { Enrichers } from "./scripts/system/enrichers.js";
import { Fonts } from "./scripts/system/fonts.js";
import {
	HandlebarsHelpers,
	HandlebarsPartials,
} from "./scripts/system/handlebars.js";
import { LitmHooks } from "./scripts/system/hooks/index.js";
import { KeyBindings } from "./scripts/system/keybindings.js";
import { migrateWorld } from "./scripts/system/migrations.js";
import { loadStatusCompendium } from "./scripts/system/hooks/token-hooks.js";
import { LitmSettings } from "./scripts/system/settings.js";
import { ContentSources } from "./scripts/system/content-sources.js";
import { Sockets } from "./scripts/system/sockets.js";

// Register Custom Elements
SuperCheckbox.Register();

// Init Hook
Hooks.once("init", () => {
	info("Initializing Legend in the Mist...");
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
			const id = game.settings?.get("litmv2", "fellowshipId");
			return id ? (game.actors?.get(id) ?? null) : null;
		},
		LitmRollDialog,
		LitmRoll,
		WelcomeOverlay,
		StoryTagApp: StoryTagSidebar,
		SpendPowerApp,
		ThemeAdvancementApp,
		rollDialogHud: null,
		ContentSources,
	};

	info("Initializing Config...");
	CONFIG.Actor.dataModels.hero = HeroData;
	CONFIG.Actor.dataModels.challenge = ChallengeData;
	CONFIG.Actor.dataModels.journey = JourneyData;
	CONFIG.Actor.dataModels.fellowship = FellowshipData;
	CONFIG.Actor.dataModels.story_theme = StoryThemeActorData;
	CONFIG.Actor.trackableAttributes.hero = HeroData.getTrackableAttributes();
	LitmSettings.register();
	if (LitmSettings.customDice) {
		CONFIG.Dice.terms[DoubleSix.DENOMINATION] = DoubleSix;
	}
	CONFIG.Dice.rolls.push(LitmRoll);
	CONFIG.Item.documentClass = LitmItem;
	CONFIG.ActiveEffect.documentClass = LitmActiveEffect;
	CONFIG.Item.dataModels.backpack = BackpackData;
	CONFIG.Item.dataModels.theme = ThemeData;
	CONFIG.Item.dataModels.themebook = ThemebookData;
	CONFIG.Item.dataModels.vignette = VignetteData;
	CONFIG.Item.dataModels.addon = AddonData;
	CONFIG.Item.dataModels.story_theme = StoryThemeData;
	CONFIG.Item.dataModels.trope = TropeData;
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
	CONFIG.litmv2 = new LitmConfig();
	CONFIG.Token.hudClass = LitmTokenHUD;

	// Replace the combat tracker sidebar tab with Story Tags
	CONFIG.ui.combat = StoryTagSidebar;
	foundry.applications.sidebar.Sidebar.TABS.combat = {
		tooltip: "LITM.Ui.manage_tags",
		icon: "fa-solid fa-tags",
	};

	info("Registering Sheets...");
	// Unregister the default sheets
	foundry.documents.collections.Actors.unregisterSheet(
		"core",
		foundry.appv1.sheets.ActorSheet,
	);
	foundry.documents.collections.Items.unregisterSheet(
		"core",
		foundry.appv1.sheets.ItemSheet,
	);
	// Register the sheets
	foundry.documents.collections.Actors.registerSheet("litmv2", HeroSheet, {
		types: ["hero"],
		makeDefault: true,
		label: "LITM.Sheets.hero",
	});
	foundry.documents.collections.Actors.registerSheet("litmv2", ChallengeSheet, {
		types: ["challenge"],
		makeDefault: true,
		label: "LITM.Sheets.challenge",
	});
	foundry.documents.collections.Actors.registerSheet("litmv2", JourneySheet, {
		types: ["journey"],
		makeDefault: true,
		label: "LITM.Sheets.journey",
	});
	foundry.documents.collections.Actors.registerSheet(
		"litmv2",
		FellowshipSheet,
		{
			types: ["fellowship"],
			makeDefault: true,
			label: "LITM.Sheets.fellowship",
		},
	);
	// Landscape variants
	foundry.documents.collections.Actors.registerSheet(
		"litmv2",
		HeroSheetLandscape,
		{
			types: ["hero"],
			makeDefault: false,
			label: "LITM.Sheets.hero_landscape",
		},
	);
	foundry.documents.collections.Actors.registerSheet(
		"litmv2",
		ChallengeSheetLandscape,
		{
			types: ["challenge"],
			makeDefault: false,
			label: "LITM.Sheets.challenge_landscape",
		},
	);
	foundry.documents.collections.Actors.registerSheet(
		"litmv2",
		JourneySheetLandscape,
		{
			types: ["journey"],
			makeDefault: false,
			label: "LITM.Sheets.journey_landscape",
		},
	);
	foundry.documents.collections.Actors.registerSheet(
		"litmv2",
		FellowshipSheetLandscape,
		{
			types: ["fellowship"],
			makeDefault: false,
			label: "LITM.Sheets.fellowship_landscape",
		},
	);
	foundry.documents.collections.Actors.registerSheet(
		"litmv2",
		StoryThemeActorSheet,
		{
			types: ["story_theme"],
			makeDefault: true,
			label: "LITM.Sheets.story_theme",
		},
	);
	foundry.documents.collections.Items.registerSheet("litmv2", BackpackSheet, {
		types: ["backpack"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet("litmv2", ThemeSheet, {
		types: ["theme"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet("litmv2", ThemebookSheet, {
		types: ["themebook"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet("litmv2", VignetteSheet, {
		types: ["vignette"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet("litmv2", AddonSheet, {
		types: ["addon"],
		makeDefault: true,
		label: "LITM.Sheets.addon",
	});
	foundry.documents.collections.Items.registerSheet("litmv2", StoryThemeSheet, {
		types: ["story_theme"],
		makeDefault: true,
	});
	foundry.documents.collections.Items.registerSheet("litmv2", TropeSheet, {
		types: ["trope"],
		makeDefault: true,
	});
	LitmActiveEffectSheet.register();

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
	await loadStatusCompendium();

	Sockets.registerListeners();

	// Alias game.litmv2.storyTags to the sidebar tab instance
	game.litmv2.storyTags = ui.combat;

	success("Successfully initialized Legend in the Mist!");
});
