import { describe, expect, it } from "vitest";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import {
	classicMightScale,
	mightFromPicks,
	mightName,
	mightScaleRows,
	rollLookClass,
} from "../modules/apps/roll/roll-dialog-context.js";

// The per-player "Roll window look" setting picks the class the Cards CSS is
// scoped under; Classic gets none, so its look cannot change.
describe("rollLookClass", () => {
	it("gives the Cards look its class", () => {
		expect(rollLookClass("cards")).toBe("litm--roll-cards");
	});

	it("leaves Classic, and anything unknown, unclassed", () => {
		expect(rollLookClass("classic")).toBeNull();
		expect(rollLookClass(undefined)).toBeNull();
	});
});

// The sheet keeps one dialog for every roll. The look must follow the setting
// each time the window opens, not stay as it was when the sheet first made it.
describe("roll window look per open", () => {
	const open = (dialog) =>
		dialog._prepareContext({ isFirstRender: true }).catch(() => {});

	it("follows the setting on the next open of the same dialog", async () => {
		const dialog = new LitmRollDialog({ actorId: "hero" });
		game.settings.get.mockImplementation(() => "cards");
		await open(dialog);
		expect(dialog.isCardsLook).toBe(true);
		game.settings.get.mockImplementation(() => "classic");
		await open(dialog);
		expect(dialog.isCardsLook).toBe(false);
	});

	it("keeps the look of an open window when it re-renders", async () => {
		const dialog = new LitmRollDialog({ actorId: "hero" });
		game.settings.get.mockImplementation(() => "cards");
		await open(dialog);
		game.settings.get.mockImplementation(() => "classic");
		await dialog._prepareContext({ isFirstRender: false }).catch(() => {});
		expect(dialog.isCardsLook).toBe(true);
	});

	it("keeps the tour preview classic", async () => {
		const dialog = new LitmRollDialog({ actorId: "hero", localOnly: true });
		game.settings.get.mockImplementation(() => "cards");
		await open(dialog);
		expect(dialog.isCardsLook).toBe(false);
	});
});

// The Might column is the Heroes' own Might, the plus; Area, Size and Group
// are what they face, and add up as the book adds "an army (5) of dragons
// (5)" into Might 10. The Action's Might is the one less the other.
describe("mightFromPicks", () => {
	it("takes the opposition's Area, Size and Group from the Heroes' Might", () => {
		expect(mightFromPicks({ might: 3, size: 5, group: 5 })).toBe(-7);
	});

	it("is the Heroes' Might alone, and 0 with nothing picked", () => {
		expect(mightFromPicks({ might: 6 })).toBe(6);
		expect(mightFromPicks({ size: 2 })).toBe(-2);
		expect(Object.is(mightFromPicks({}), 0)).toBe(true);
	});
});

// The caption names the Might as the book does; steps between show no name.
describe("mightName", () => {
	it("names Favoured from ±3 and Extremely from ±6, and not Equal", () => {
		expect(mightName(0)).toBe("");
		expect(mightName(2)).toBe("");
		expect(mightName(-3)).toBe("LITM.Ui.might_imperiled_short");
		expect(mightName(-5)).toBe("LITM.Ui.might_imperiled_short");
		expect(mightName(4)).toBe("LITM.Ui.might_favored_short");
		expect(mightName(6)).toBe("LITM.Ui.might_extremely_favored_short");
		expect(mightName(-10)).toBe("LITM.Ui.might_extremely_imperiled_short");
	});
});

// A tier spans its rows: Adventure is 2, 3 and 4, so a pick of any of them
// is an Adventure Might, though a click on the tier picks 3.
describe("mightScaleRows", () => {
	it("gives each tier the Might it picks and the rows it spans", () => {
		const tiers = mightScaleRows()
			.filter((row) => row.tier)
			.map(({ tier }) => [tier.level, tier.might, tier.first, tier.last]);
		expect(tiers).toEqual([
			["origin", 0, 0, 1],
			["adventure", 3, 2, 4],
			["greatness", 6, 5, 6],
		]);
	});
});

describe("classicMightScale", () => {
	it("lights the matching segment inside ±6, ends reading ±6", () => {
		expect(classicMightScale(3)).toEqual({
			radio: 3,
			checked: 3,
			low: "-6",
			high: "+6",
		});
		expect(classicMightScale(-6)).toEqual({
			radio: -6,
			checked: -6,
			low: "-6",
			high: "+6",
		});
	});

	it("lights the end past ±6, unchecked so a click caps it, and shows the real value", () => {
		expect(classicMightScale(9)).toEqual({
			radio: 6,
			checked: null,
			low: "-6",
			high: "+9",
		});
		expect(classicMightScale(-18)).toEqual({
			radio: -6,
			checked: null,
			low: "-18",
			high: "+6",
		});
	});
});
