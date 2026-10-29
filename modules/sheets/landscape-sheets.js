import { ChallengeSheet } from "../actor/challenge/challenge-sheet.js";
import { FellowshipSheet } from "../actor/fellowship/fellowship-sheet.js";
import { HeroSheet } from "../actor/hero/hero-sheet.js";
import { JourneySheet } from "../actor/journey/journey-sheet.js";
import { LitmActorSheet } from "./base-actor-sheet.js";

const LANDSCAPE_OPTIONS = {
	classes: ["litm-landscape"],
	position: {
		width: LitmActorSheet.LANDSCAPE_WIDTH,
	},
};

/**
 * The hero landscape variant starts wider so the responsive board layout
 * (4-up themes, split inventory/fellowship band, 3-up story themes) kicks
 * in by default. The layout itself is driven by container queries on
 * .litm-hero-sheet, so resizing either variant past the breakpoint shows
 * the same wide layout; this just picks the initial width.
 */
export class HeroSheetLandscape extends HeroSheet {
	static DEFAULT_OPTIONS = {
		classes: ["litm-landscape"],
		position: { width: 1280 },
	};
}

export class ChallengeSheetLandscape extends ChallengeSheet {
	static DEFAULT_OPTIONS = LANDSCAPE_OPTIONS;
}

export class JourneySheetLandscape extends JourneySheet {
	static DEFAULT_OPTIONS = LANDSCAPE_OPTIONS;
}

export class FellowshipSheetLandscape extends FellowshipSheet {
	static DEFAULT_OPTIONS = LANDSCAPE_OPTIONS;
}
