import { LitmActiveEffectSheet } from "../active-effects/active-effect-sheet.js";
import { ChallengeSheet } from "../actor/challenge/challenge-sheet.js";
import { FellowshipSheet } from "../actor/fellowship/fellowship-sheet.js";
import { HeroSheet } from "../actor/hero/hero-sheet.js";
import { JourneySheet } from "../actor/journey/journey-sheet.js";
import { StoryThemeActorSheet } from "../actor/story-theme/story-theme-actor-sheet.js";
import { ActionSheet } from "../item/action/action-sheet.js";
import { AddonSheet } from "../item/addon/addon-sheet.js";
import { BackpackSheet } from "../item/backpack/backpack-sheet.js";
import { StoryThemeSheet } from "../item/story-theme/story-theme-sheet.js";
import { ThemeSheet } from "../item/theme/theme-sheet.js";
import { ThemebookSheet } from "../item/themebook/themebook-sheet.js";
import { TropeSheet } from "../item/trope/trope-sheet.js";
import { VignetteSheet } from "../item/vignette/vignette-sheet.js";
import { info } from "../logger.js";
import { LitmJournalSheet } from "../sheets/journal-sheet.js";
import {
	ChallengeSheetLandscape,
	FellowshipSheetLandscape,
	HeroSheetLandscape,
	JourneySheetLandscape,
} from "../sheets/landscape-sheets.js";

export class LitmSheets {
	static register() {
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
		foundry.documents.collections.Actors.registerSheet(
			"litmv2",
			ChallengeSheet,
			{
				types: ["challenge"],
				makeDefault: true,
				label: "LITM.Sheets.challenge",
			},
		);
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
		foundry.documents.collections.Items.registerSheet(
			"litmv2",
			ThemebookSheet,
			{
				types: ["themebook"],
				makeDefault: true,
			},
		);
		foundry.documents.collections.Items.registerSheet("litmv2", VignetteSheet, {
			types: ["vignette"],
			makeDefault: true,
		});
		foundry.documents.collections.Items.registerSheet("litmv2", AddonSheet, {
			types: ["addon"],
			makeDefault: true,
			label: "LITM.Sheets.addon",
		});
		foundry.documents.collections.Items.registerSheet(
			"litmv2",
			StoryThemeSheet,
			{
				types: ["story_theme"],
				makeDefault: true,
			},
		);
		foundry.documents.collections.Items.registerSheet("litmv2", TropeSheet, {
			types: ["trope"],
			makeDefault: true,
		});
		foundry.documents.collections.Items.registerSheet("litmv2", ActionSheet, {
			types: ["action"],
			makeDefault: true,
			label: "LITM.Sheets.action",
		});
		// Rulebook journal sheet — non-default; documents opt in via
		// flags.core.sheetClass (e.g. converted LitM content), so ordinary
		// world journals keep the core sheet.
		foundry.applications.apps.DocumentSheetConfig.registerSheet(
			foundry.documents.JournalEntry,
			"litmv2",
			LitmJournalSheet,
			{
				makeDefault: false,
				label: "LITM.Sheets.journal",
			},
		);
		LitmActiveEffectSheet.register();
	}
}
