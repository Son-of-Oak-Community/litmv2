import { afterEach, describe, expect, it } from "vitest";
import { LitmRoll } from "../modules/apps/roll/roll.js";

// Core Book p.151: 10 or more is a success, 7 to 9 a success with
// Consequences, 6 or less Consequences; double ones always fail and double
// sixes always succeed, whatever the Power. `LitmRoll#outcome` reads the dice
// for the doubles and the total (dice plus Power) for the bands.

/** A rolled LitmRoll: two dice and the Power added to them. */
const rolled = (dice, power = 0, options = {}) => {
	const roll = new LitmRoll();
	roll.options = { type: "quick", ...options };
	roll.dice = dice.map((total) => ({ total }));
	roll.total = dice[0] + dice[1] + power;
	return roll;
};
const label = (...args) => rolled(...args).outcome.label;

afterEach(() => {
	CONFIG.litmv2.roll.resolver = null;
});

describe("LitmRoll#outcome", () => {
	it.each([
		[[3, 3], 0, "consequences"],
		[[3, 3], 1, "snc"],
		[[4, 5], 0, "snc"],
		[[4, 5], 1, "success"],
		[[2, 2], 6, "success"],
		// Power counts both ways: a negative total drops a band.
		[[4, 3], -1, "consequences"],
		[[6, 4], -1, "snc"],
	])("reads dice %j with Power %i as %s", (dice, power, expected) => {
		expect(label(dice, power)).toBe(expected);
	});

	it("fails on double ones whatever the Power", () => {
		expect(label([1, 1], 9)).toBe("consequences");
	});

	it("succeeds on double sixes whatever the Power", () => {
		expect(label([6, 6], -9)).toBe("success");
	});

	it("turns a pushed success into a success with Consequences", () => {
		expect(rolled([5, 5], 0, { pushed: true }).outcome).toMatchObject({
			label: "snc",
			pushed: true,
			great: true,
		});
		// Only a Quick outcome has a great success to keep.
		expect(
			rolled([5, 5], 0, { pushed: true, type: "tracked" }).outcome,
		).toMatchObject({ label: "snc", pushed: true, great: false });
		// Pushing does not rescue anything below a success.
		expect(rolled([4, 4], 0, { pushed: true }).outcome.pushed).toBeUndefined();
	});

	it("falls back to the Quick bands for a move it does not know", () => {
		expect(label([5, 5], 0, { type: "campAction" })).toBe("success");
	});

	it("hands the whole judgement to CONFIG.litmv2.roll.resolver when a module sets one", () => {
		const seen = [];
		CONFIG.litmv2.roll.resolver = (roll) => {
			seen.push(roll);
			return { label: "success", description: "house rule" };
		};
		const roll = rolled([1, 1]);
		expect(roll.outcome).toEqual({
			label: "success",
			description: "house rule",
		});
		expect(seen).toEqual([roll]);
	});
});

// p.159: a Sacrifice adds no Power; it reads Miracle / Fate / In Vain off the
// same bands, with the Narrator's bonus the only thing added.
describe("a Sacrifice's outcome", () => {
	const sacrifice = (dice, bonus = 0) =>
		rolled(dice, bonus, { type: "sacrifice" }).outcome;

	it.each([
		[[3, 3], 0, "consequences", "LITM.Ui.roll_sacrifice_failure"],
		[[4, 3], 0, "snc", "LITM.Ui.roll_sacrifice_mixed"],
		[[5, 4], 0, "snc", "LITM.Ui.roll_sacrifice_mixed"],
		[[5, 5], 0, "success", "LITM.Ui.roll_sacrifice_success"],
		// The Secret Grace bonus can lift a band.
		[[5, 4], 1, "success", "LITM.Ui.roll_sacrifice_success"],
		[[3, 3], 1, "snc", "LITM.Ui.roll_sacrifice_mixed"],
	])("reads dice %j with bonus %i as %s", (dice, bonus, expected, text) => {
		expect(sacrifice(dice, bonus)).toEqual({
			label: expected,
			description: text,
		});
	});

	it("is In Vain on double ones and a Miracle on double sixes, whatever the bonus", () => {
		expect(sacrifice([1, 1], 6).label).toBe("consequences");
		expect(sacrifice([6, 6], -6).label).toBe("success");
	});
});

// The Power a roll leaves to spend: never less than 1 on a hit (the Rule of
// Minimum One), none on Consequences, and only Detailed outcomes and Reactions
// have any. Trade Power: a Hedge spends the original Power minus 1, Caution
// the original plus 1.
describe("LitmRoll#power", () => {
	const power = (dice, options) =>
		rolled(dice, 0, { type: "tracked", ...options }).power;

	it("is not a thing on a Quick outcome or a Sacrifice", () => {
		expect(power([5, 5], { type: "quick", totalPower: 3 })).toBeNull();
		expect(power([5, 5], { type: "sacrifice", totalPower: 3 })).toBeNull();
	});

	it("is the roll's Power on a hit", () => {
		expect(power([5, 5], { totalPower: 3 })).toBe(3);
		expect(power([4, 4], { totalPower: 3 })).toBe(3);
	});

	it("is nothing on Consequences", () => {
		expect(power([2, 3], { totalPower: 3 })).toBe(0);
	});

	it("is never less than 1 on a hit", () => {
		expect(power([5, 5], { totalPower: 0 })).toBe(1);
		expect(power([6, 6], { totalPower: -4 })).toBe(1);
	});

	it("gives up what was traded for a Hedge, down to 1", () => {
		expect(power([5, 5], { totalPower: 4, tradePower: 1 })).toBe(3);
		expect(power([5, 5], { totalPower: 2, tradePower: 1 })).toBe(1);
		expect(power([5, 5], { totalPower: 1, tradePower: 1 })).toBe(1);
	});

	it("gains what Caution held back", () => {
		expect(power([5, 5], { totalPower: 2, tradePower: -1 })).toBe(3);
	});

	it("adds 1 to a Reaction that succeeds outright, and only then", () => {
		expect(power([5, 5], { type: "mitigate", totalPower: 2 })).toBe(3);
		expect(power([4, 4], { type: "mitigate", totalPower: 2 })).toBe(2);
	});

	it("adds 1 to a pushed roll", () => {
		expect(power([5, 5], { totalPower: 2, pushed: true })).toBe(3);
	});
});
