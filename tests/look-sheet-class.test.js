import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LitmActor } from "../modules/actor/litm-actor.js";

class HeroSheet {}
class HeroSheetCards {}
class HeroSheetLandscape {}
class FellowshipSheet {}
class FellowshipSheetCards {}

const Base = Object.getPrototypeOf(LitmActor.prototype);

// Foundry's own pick for this actor, and the per-document override flag.
const actor = ({ type = "hero", base = HeroSheet, override = null } = {}) => {
	const a = new LitmActor({ type });
	Base._getSheetClass = () => base;
	a.getFlag = (scope, key) =>
		scope === "core" && key === "sheetClass" ? override : undefined;
	return a;
};

describe("LitmActor#_getSheetClass and the Cards look", () => {
	let look;
	beforeEach(() => {
		globalThis.CONFIG.Actor = {
			sheetClasses: {
				hero: {
					"litmv2.HeroSheet": { cls: HeroSheet },
					"litmv2.HeroSheetCards": { cls: HeroSheetCards },
					"litmv2.HeroSheetLandscape": { cls: HeroSheetLandscape },
				},
				fellowship: {
					"litmv2.FellowshipSheet": { cls: FellowshipSheet },
					"litmv2.FellowshipSheetCards": { cls: FellowshipSheetCards },
				},
			},
		};
		game.settings.get.mockImplementation((ns, key) =>
			ns === "litmv2" && key === "look" ? look : undefined,
		);
	});
	afterEach(() => {
		delete Base._getSheetClass;
		game.settings.get.mockReset();
	});

	it("gives a hero the Cards sheet when the player picked Cards", () => {
		look = "cards";
		expect(actor()._getSheetClass()).toBe(HeroSheetCards);
	});

	it("keeps the default sheet on Classic", () => {
		look = "classic";
		expect(actor()._getSheetClass()).toBe(HeroSheet);
	});

	it("keeps a sheet picked in Configure Sheet", () => {
		look = "cards";
		expect(actor({ override: "litmv2.HeroSheet" })._getSheetClass()).toBe(
			HeroSheet,
		);
	});

	it("ignores a pick whose module is gone", () => {
		look = "cards";
		expect(actor({ override: "gone.Sheet" })._getSheetClass()).toBe(
			HeroSheetCards,
		);
	});

	it("keeps another default the Narrator set for heroes", () => {
		look = "cards";
		expect(actor({ base: HeroSheetLandscape })._getSheetClass()).toBe(
			HeroSheetLandscape,
		);
	});

	it("gives the Fellowship its Cards sheet too", () => {
		look = "cards";
		expect(
			actor({ type: "fellowship", base: FellowshipSheet })._getSheetClass(),
		).toBe(FellowshipSheetCards);
	});

	it("leaves other actor types alone", () => {
		look = "cards";
		expect(actor({ type: "challenge" })._getSheetClass()).toBe(HeroSheet);
	});
});
