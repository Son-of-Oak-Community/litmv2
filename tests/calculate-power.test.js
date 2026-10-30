import { describe, expect, it } from "vitest";
import { LitmRoll } from "../modules/apps/roll/roll.js";
import { BURN_POWER } from "../modules/system/config.js";

const baseTags = {
	scratchedTags: [],
	powerTags: [],
	weaknessTags: [],
	positiveStatuses: [],
	negativeStatuses: [],
	modifier: 0,
	might: 0,
};

const status = (tier) => ({ system: { currentTier: tier } });

describe("LitmRoll.calculatePower", () => {
	it("returns zero for an empty roll", () => {
		expect(LitmRoll.calculatePower(baseTags).totalPower).toBe(0);
	});

	it("adds +1 per power tag and -1 per weakness tag", () => {
		const { totalPower } = LitmRoll.calculatePower({
			...baseTags,
			powerTags: [{}, {}, {}],
			weaknessTags: [{}],
		});
		expect(totalPower).toBe(2);
	});

	it("uses only the highest status on each side", () => {
		const { totalPower, positiveStatusValue, negativeStatusValue } =
			LitmRoll.calculatePower({
				...baseTags,
				positiveStatuses: [status(2), status(4), status(1)],
				negativeStatuses: [status(3), status(1)],
			});
		expect(positiveStatusValue).toBe(4);
		expect(negativeStatusValue).toBe(3);
		expect(totalPower).toBe(1);
	});

	it("adds BURN_POWER for a burned tag", () => {
		const { totalPower } = LitmRoll.calculatePower({
			...baseTags,
			scratchedTags: [{}],
			powerTags: [{}],
		});
		expect(totalPower).toBe(BURN_POWER + 1);
	});

	it("caps burn at one tag per roll (p.158)", () => {
		const { totalPower, scratchedValue } = LitmRoll.calculatePower({
			...baseTags,
			scratchedTags: [{}, {}, {}],
		});
		expect(scratchedValue).toBe(BURN_POWER);
		expect(totalPower).toBe(BURN_POWER);
	});

	it("includes modifier and might offset in the total", () => {
		const { totalPower } = LitmRoll.calculatePower({
			...baseTags,
			modifier: 2,
			might: -3,
		});
		expect(totalPower).toBe(-1);
	});
});

describe("LitmRoll.powerBySource", () => {
	const tag = (src, state, extra = {}) => ({ src, state, ...extra });
	const st = (src, state, tier) =>
		tag(src, state, { type: "status_tag", system: { currentTier: tier } });
	const sourceOf = (t) => t.src;

	it("credits each source with what its tags add, matching the total", () => {
		const tags = [
			tag("hero", "positive"),
			tag("hero", "positive"),
			tag("hero", "negative"),
			tag("allies", "scratched"),
			st("scene", "positive", 2),
			st("hero", "positive", 3),
			st("scene", "negative", 2),
			tag("scene", ""),
		];
		const bySource = LitmRoll.powerBySource(tags, sourceOf);
		// Only the strongest positive status (hero, 3) counts; scene's 2 does not.
		expect(bySource).toEqual({ hero: 4, allies: BURN_POWER, scene: -2 });
		const { totalPower } = LitmRoll.calculatePower({
			...LitmRoll.filterTags(tags),
			modifier: 0,
			might: 0,
		});
		const sum = Object.values(bySource).reduce((a, b) => a + b, 0);
		expect(sum).toBe(totalPower);
	});

	it("skips tags with no source", () => {
		expect(LitmRoll.powerBySource([tag(null, "positive")], sourceOf)).toEqual(
			{},
		);
	});
});
