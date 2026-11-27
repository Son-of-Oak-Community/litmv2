import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LitmActor } from "../modules/actor/litm-actor.js";
import { refreshCardsSheets } from "../modules/system/settings.js";

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

describe("refreshCardsSheets hands the roll window to the new sheet", () => {
	const saved = {};
	beforeEach(() => {
		saved.filter = game.actors.filter;
		saved.instances = foundry.applications.instances;
		saved.documentClass = CONFIG.Actor?.documentClass;
		CONFIG.Actor ??= {};
		CONFIG.Actor.documentClass = { CARDS_SHEETS: { hero: [] } };
		foundry.applications.instances = new Map();
	});
	afterEach(() => {
		game.actors.filter = saved.filter;
		foundry.applications.instances = saved.instances;
		CONFIG.Actor.documentClass = saved.documentClass;
	});

	// A Classic sheet holding a dialog; the look now asks for NewSheet.
	function heroWith(dialog) {
		class NewSheet {
			adopted = null;
			adoptRollDialog(d) {
				this.adopted = d;
			}
			render() {}
		}
		const old = {
			rendered: true,
			hasRollDialog: !!dialog,
			rollDialogInstance: dialog,
			close: async () => {},
		};
		const hero = {
			type: "hero",
			_sheet: old,
			_getSheetClass: () => NewSheet,
			get sheet() {
				this._sheet ??= new NewSheet();
				return this._sheet;
			},
		};
		game.actors.filter = (fn) => [hero].filter(fn);
		return hero;
	}

	it("moves a closed dialog (a draft awaiting approval)", async () => {
		const dialog = { rendered: false };
		const hero = heroWith(dialog);
		await refreshCardsSheets();
		expect(hero.sheet.adopted).toBe(dialog);
	});

	it("moves an open dialog instead of keeping the old sheet", async () => {
		const dialog = { rendered: true };
		const hero = heroWith(dialog);
		await refreshCardsSheets();
		expect(hero.sheet.adopted).toBe(dialog);
	});
});
