import { describe, expect, it } from "vitest";
import {
	computePowerBudget,
	computeSuccessSpend,
	getAllowedVerbs,
	getMinSuccessCost,
	getSuccessCost,
} from "../modules/item/action/action-rules.js";
import { successTargetMode } from "../modules/item/action/verb-definitions.js";

const rollOf = (type, outcomeLabel = "success") => ({
	outcome: { label: outcomeLabel },
	litm: { type },
});

describe("getAllowedVerbs", () => {
	it("returns empty set on consequences (failure) regardless of type", () => {
		for (const t of ["quick", "tracked", "mitigate", "sacrifice"]) {
			expect(getAllowedVerbs(rollOf(t, "consequences"))).toEqual(new Set());
		}
	});

	it("quick roll unlocks quick + extraFeat only", () => {
		expect(getAllowedVerbs(rollOf("quick"))).toEqual(
			new Set(["quick", "extraFeat"]),
		);
	});

	it("tracked roll unlocks all detailed verbs plus quick + extraFeat", () => {
		const allowed = getAllowedVerbs(rollOf("tracked"));
		// Spot-check the canonical set.
		for (const v of [
			"quick",
			"create",
			"bestow",
			"enhance",
			"restore",
			"attack",
			"disrupt",
			"influence",
			"weaken",
			"advance",
			"setBack",
			"discover",
			"extraFeat",
		]) {
			expect(allowed.has(v)).toBe(true);
		}
		// Lessen is reaction-only — must not appear on a tracked roll.
		expect(allowed.has("lessen")).toBe(false);
	});

	it("mitigate (reaction) roll unlocks lessen + extraFeat only", () => {
		expect(getAllowedVerbs(rollOf("mitigate"))).toEqual(
			new Set(["lessen", "extraFeat"]),
		);
	});

	it("sacrifice roll unlocks nothing (narrative-only mechanic)", () => {
		expect(getAllowedVerbs(rollOf("sacrifice"))).toEqual(new Set());
	});

	it("returns empty for unrecognized roll types", () => {
		expect(getAllowedVerbs(rollOf("nonsense"))).toEqual(new Set());
		expect(getAllowedVerbs(null)).toEqual(new Set());
		expect(getAllowedVerbs(undefined)).toEqual(new Set());
	});
});

describe("getSuccessCost", () => {
	const cost = (verb, text = "") => getSuccessCost({ verb, text });

	it("returns 0 fixed / 0 variable for null or unknown verbs", () => {
		expect(getSuccessCost(null)).toEqual({
			fixed: 0,
			variableTokens: 0,
			tagCosts: [],
		});
		expect(getSuccessCost({ verb: "not-a-verb" })).toEqual({
			fixed: 0,
			variableTokens: 0,
			tagCosts: [],
		});
	});

	it("Quick verb is free (narrative)", () => {
		expect(cost("quick", "Find a hidden path")).toEqual({
			fixed: 0,
			variableTokens: 0,
			tagCosts: [],
		});
	});

	it("Discover is a flat 1 Power regardless of markup", () => {
		expect(cost("discover", "Find their true name")).toEqual({
			fixed: 1,
			variableTokens: 0,
			tagCosts: [],
		});
		expect(cost("discover", "")).toEqual({
			fixed: 1,
			variableTokens: 0,
			tagCosts: [],
		});
	});

	it("ExtraFeat is a flat 1 Power", () => {
		expect(cost("extraFeat", "")).toEqual({
			fixed: 1,
			variableTokens: 0,
			tagCosts: [],
		});
	});

	it("Create + [name] = 2 Power (regular story tag)", () => {
		expect(cost("create", "Get a [map] of the area.")).toEqual({
			fixed: 2,
			variableTokens: 0,
			tagCosts: [2],
		});
	});

	it("Create + [name!] = 1 Power (single-use story tag)", () => {
		expect(cost("create", "Stash a [smoke bomb!] for later.")).toEqual({
			fixed: 1,
			variableTokens: 0,
			tagCosts: [1],
		});
	});

	it("Attack + [status-N] = N Power (status at concrete tier)", () => {
		expect(cost("attack", "Inflict [wounded-2] on the foe.")).toEqual({
			fixed: 2,
			variableTokens: 0,
			tagCosts: [],
		});
		expect(cost("attack", "[bleeding-3]")).toEqual({
			fixed: 3,
			variableTokens: 0,
			tagCosts: [],
		});
	});

	it("Attack + [status-] surfaces a variable token (tier picked at apply)", () => {
		expect(cost("attack", "Cause [bleeding-]")).toEqual({
			fixed: 0,
			variableTokens: 1,
			tagCosts: [],
		});
	});

	it("sums multiple tokens in one text", () => {
		// Bestow + two tags = 4 Power, each tag surfaced for chip selection.
		expect(
			cost("bestow", "Grant [basic spear training] and [parrying stance]"),
		).toEqual({ fixed: 4, variableTokens: 0, tagCosts: [2, 2] });

		// Mixed concrete and variable.
		expect(cost("attack", "[wounded-2] and [shaken-]")).toEqual({
			fixed: 2,
			variableTokens: 1,
			tagCosts: [],
		});
	});

	it("verb with no markup at all costs 0 (nothing to apply)", () => {
		expect(cost("create", "Set the scene mood")).toEqual({
			fixed: 0,
			variableTokens: 0,
			tagCosts: [],
		});
	});

	it("Weaken + [name] = 2 Power (scratch a tag on target)", () => {
		expect(cost("weaken", "Knock away their [shield]")).toEqual({
			fixed: 2,
			variableTokens: 0,
			tagCosts: [2],
		});
	});

	it("Weaken + [status-1] = 1 Power (reduce a status by 1 tier)", () => {
		expect(cost("weaken", "Reduce their [enraged-1]")).toEqual({
			fixed: 1,
			variableTokens: 0,
			tagCosts: [],
		});
	});
});

describe("getMinSuccessCost", () => {
	const min = (verb, text) => getMinSuccessCost(getSuccessCost({ verb, text }));

	it("equals the fixed cost when there are no tags", () => {
		expect(min("attack", "[wounded-2]")).toBe(2);
		expect(min("attack", "[bleeding-]")).toBe(0);
		expect(min("quick", "Find a hidden path")).toBe(0);
	});

	it("equals the fixed cost for a single tag (nothing to deselect)", () => {
		expect(min("create", "Get a [map] of the area.")).toBe(2);
	});

	it("counts only the cheapest tag when 2+ tags are selectable", () => {
		// "either or both" — 2 tags at 2 Power each → floor is one tag.
		expect(min("create", "Get a [hunting bow], a [short blade]")).toBe(2);
		// A single-use tag is the cheapest pick.
		expect(min("create", "Get a [hunting bow], a [torch!]")).toBe(1);
	});

	it("keeps non-tag fixed costs in the floor", () => {
		// Two selectable tags + a concrete status: floor = status + cheapest tag.
		expect(min("attack", "[net] [harpoon] and [snared-2]")).toBe(4);
	});
});

describe("computeSuccessSpend", () => {
	const spend = (verb, text, choices) =>
		computeSuccessSpend(getSuccessCost({ verb, text }), choices);

	it("charges the full fixed cost when no choices are made", () => {
		expect(spend("create", "Get a [map] of the area.")).toBe(2);
		expect(spend("create", "Get a [hunting bow], a [short blade]")).toBe(4);
	});

	it("drops deselected tag chips from the bill", () => {
		expect(
			spend("create", "Get a [hunting bow], a [short blade]", {
				chosenTags: [true, false],
			}),
		).toBe(2);
		// Sparse array — only explicit false drops a tag.
		expect(
			spend("create", "Get a [hunting bow], a [short blade]", {
				chosenTags: [],
			}),
		).toBe(4);
	});

	it("adds the tiers picked for variable-status tokens", () => {
		expect(spend("attack", "[wounded-]", { chosenTiers: [3] })).toBe(3);
		// Tier 0 / skipped tokens add nothing.
		expect(spend("attack", "[wounded-]", { chosenTiers: [0] })).toBe(0);
	});

	it("combines fixed, dropped tags, and chosen tiers", () => {
		expect(
			spend("attack", "[net] [harpoon] and [snared-]", {
				chosenTags: [false, true],
				chosenTiers: [2],
			}),
		).toBe(4); // harpoon 2 + tier 2
	});
});

describe("successTargetMode", () => {
	const def = (target) => ({ target });

	it("defaults to self", () => {
		expect(successTargetMode(def("self"), {})).toBe("self");
		expect(successTargetMode(null, {})).toBe("self");
	});

	it("verb-level process/opponent override the payload", () => {
		expect(
			successTargetMode(def("opponent"), { payload: { target: "ally" } }),
		).toBe("opponent");
		expect(
			successTargetMode(def("process"), { payload: { target: "self" } }),
		).toBe("process");
	});

	it("payload escalates a self verb to opponent/ally/prompt/process", () => {
		expect(
			successTargetMode(def("self"), { payload: { target: "opponent" } }),
		).toBe("opponent");
		expect(
			successTargetMode(def("self"), { payload: { target: "ally" } }),
		).toBe("ally");
		expect(
			successTargetMode(def("self"), { payload: { target: "prompt" } }),
		).toBe("prompt");
		expect(
			successTargetMode(def("self"), { payload: { target: "process" } }),
		).toBe("process");
	});
});

describe("computePowerBudget", () => {
	it("returns {power, spent: 0, remaining: power} when nothing applied", () => {
		const roll = { power: 5, ...rollOf("tracked") };
		const sys = { successes: [{ id: "s1", verb: "create", text: "[map]" }] };
		expect(computePowerBudget(roll, sys, [])).toEqual({
			power: 5,
			spent: 0,
			remaining: 5,
		});
	});

	it("sums fixed + variableTokens (assuming tier 1) for applied successes by default", () => {
		const roll = { power: 5, ...rollOf("tracked") };
		const sys = {
			successes: [
				{ id: "s1", verb: "create", text: "[map]" }, // 2
				{ id: "s2", verb: "attack", text: "[wounded-]" }, // 1 variable
			],
		};
		expect(computePowerBudget(roll, sys, ["s1", "s2"])).toEqual({
			power: 5,
			spent: 3,
			remaining: 2,
		});
	});

	it("uses appliedCostsById override when the caller passed a chosen tier", () => {
		const roll = { power: 5, ...rollOf("tracked") };
		const sys = {
			successes: [{ id: "s1", verb: "attack", text: "[wounded-]" }],
		};
		// Player picked tier 3 → costs 3.
		expect(computePowerBudget(roll, sys, ["s1"], { s1: 3 })).toEqual({
			power: 5,
			spent: 3,
			remaining: 2,
		});
	});

	it("clamps remaining to 0 when overspent", () => {
		const roll = { power: 2, ...rollOf("tracked") };
		const sys = {
			successes: [{ id: "s1", verb: "attack", text: "[wounded-6]" }],
		};
		expect(computePowerBudget(roll, sys, ["s1"]).remaining).toBe(0);
	});
});
