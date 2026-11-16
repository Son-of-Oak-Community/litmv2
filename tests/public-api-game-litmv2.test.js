import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
	FellowshipTagData,
	PowerTagData,
	RelationshipTagData,
	StatusTagData,
	StoryTagData,
	WeaknessTagData,
} from "../modules/active-effects/index.js";
import { LitmRoll } from "../modules/apps/roll/roll.js";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import { StoryTagSidebar } from "../modules/apps/story-tags/story-tag-sidebar.js";
import { buildPublicApi } from "../modules/system/public-api.js";
import { stubSettings } from "./__helpers__/settings.js";

// `game.litmv2` is what modules and macros reach for: classes they replace or
// subclass, the tag data models, the Fellowship. A name dropped here breaks
// them without breaking the system, so the names are pinned. Adding one means
// adding it here; removing one is a breaking change.

describe("game.litmv2 (buildPublicApi)", () => {
	it("has exactly these names", () => {
		expect(Object.keys(buildPublicApi()).sort()).toEqual(
			[
				"ApplyActionMenuApp",
				"CallForRollApp",
				"ContentSources",
				"LitmCampingScene",
				"LitmRoll",
				"LitmRollDialog",
				"SecretGraceApp",
				"SpendPowerApp",
				"StoryTagApp",
				"ThemeAdvancementApp",
				"ThemeBrowser",
				"ThemeEvolutionWizard",
				"WelcomeOverlay",
				"callForRollHud",
				"campingHud",
				"data",
				"fellowship",
				"methods",
				"rollDialogHud",
				"showSacrificeBanner",
			].sort(),
		);
	});

	it("offers each replaceable app as a class and the banner as a function", () => {
		const api = buildPublicApi();
		for (const name of [
			"ApplyActionMenuApp",
			"CallForRollApp",
			"LitmCampingScene",
			"LitmRoll",
			"LitmRollDialog",
			"SecretGraceApp",
			"SpendPowerApp",
			"StoryTagApp",
			"ThemeAdvancementApp",
			"ThemeBrowser",
			"ThemeEvolutionWizard",
			"WelcomeOverlay",
			"ContentSources",
		]) {
			expect(typeof api[name], name).toBe("function");
		}
		expect(api.LitmRoll).toBe(LitmRoll);
		expect(api.LitmRollDialog).toBe(LitmRollDialog);
		expect(api.StoryTagApp).toBe(StoryTagSidebar);
		expect(typeof api.showSacrificeBanner).toBe("function");
	});

	it("offers the six tag data models", () => {
		expect(buildPublicApi().data).toEqual({
			PowerTagData,
			WeaknessTagData,
			FellowshipTagData,
			RelationshipTagData,
			StoryTagData,
			StatusTagData,
		});
	});

	it("keeps calculatePower under methods", () => {
		expect(buildPublicApi().methods).toEqual({
			calculatePower: LitmRoll.calculatePower,
		});
		expect(typeof LitmRoll.calculatePower).toBe("function");
	});

	it("starts with the HUD slots empty, for the ready hook to fill", () => {
		const api = buildPublicApi();
		expect(api.rollDialogHud).toBeNull();
		expect(api.callForRollHud).toBeNull();
		expect(api.campingHud).toBeNull();
	});

	it("builds a new object each time, so one world's changes are its own", () => {
		const first = buildPublicApi();
		first.rollDialogHud = {};
		expect(buildPublicApi().rollDialogHud).toBeNull();
	});

	describe("fellowship", () => {
		const theFellowship = { id: "f-1", type: "fellowship" };

		beforeEach(() => {
			game.actors.get.mockReset();
			game.actors.get.mockImplementation((id) =>
				id === "f-1" ? theFellowship : undefined,
			);
		});

		it("is the world's Fellowship actor, read when asked for", () => {
			const api = buildPublicApi();
			stubSettings({ use_fellowship: true, fellowshipId: "f-1" });

			expect(api.fellowship).toBe(theFellowship);
		});

		it("is null with the Fellowship turned off", () => {
			stubSettings({ use_fellowship: false, fellowshipId: "f-1" });

			expect(buildPublicApi().fellowship).toBeNull();
			expect(game.actors.get).not.toHaveBeenCalled();
		});

		it("is null when no Fellowship is stored, or the stored one is gone", () => {
			stubSettings({ use_fellowship: true, fellowshipId: "" });
			expect(buildPublicApi().fellowship).toBeNull();

			stubSettings({ use_fellowship: true, fellowshipId: "deleted" });
			expect(buildPublicApi().fellowship).toBeNull();
		});
	});
});

// litmv2.js itself cannot be imported here (it registers custom elements and
// sheets at load). This is the one line that connects it to the surface above.
describe("litmv2.js", () => {
	it("assigns the built surface to game.litmv2 on init", () => {
		const source = readFileSync(
			new URL("../litmv2.js", import.meta.url),
			"utf8",
		);
		expect(source).toMatch(/game\.litmv2 = buildPublicApi\(\);/);
	});
});
