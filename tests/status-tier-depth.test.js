import { afterEach, describe, expect, it } from "vitest";
import {
	clampTier,
	maxStatusTier,
	padTiers,
	StatusTagData,
} from "../modules/active-effects/status-tag-data.js";
import { toTiers } from "../modules/apps/story-tags/story-tag-helpers.js";
import { classifyTagStringMatch } from "../modules/item/action/tag-string.js";
import { LitmConfig, makeTagStringRe } from "../modules/system/config.js";

// Homebrew worlds deepen every status track: CONFIG.litmv2.maxStatusTier is
// derived as max(6, heroLimit + 1), so a Hero Limit of 7 means overcome at 7
// and permanent (death or transformation) at 8. Existing effects are never
// migrated — they pad on read and catch up on the next write.

/** Point the global CONFIG at the real derived slot for a given Hero Limit. */
function withHeroLimit(heroLimit) {
	CONFIG.litmv2 = Object.create(LitmConfig);
	CONFIG.litmv2.heroLimit = heroLimit;
	CONFIG.litmv2._maxStatusTierOverride = null;
}

const original = CONFIG.litmv2;
afterEach(() => {
	CONFIG.litmv2 = original;
});

describe("maxStatusTier derivation", () => {
	it("gives the core book's six boxes at the default Hero Limit", () => {
		withHeroLimit(5);
		expect(maxStatusTier()).toBe(6);
	});

	it("deepens the track by one past a homebrew Hero Limit", () => {
		withHeroLimit(7);
		expect(maxStatusTier()).toBe(8);
		withHeroLimit(9);
		expect(maxStatusTier()).toBe(10);
	});

	it("keeps six boxes in gritty worlds so challenges don't shrink", () => {
		withHeroLimit(3);
		expect(maxStatusTier()).toBe(6);
		withHeroLimit(1);
		expect(maxStatusTier()).toBe(6);
	});

	it("lets a module decouple the ceiling from the Hero Limit", () => {
		withHeroLimit(5);
		CONFIG.litmv2.maxStatusTier = 8;
		expect(maxStatusTier()).toBe(8);
	});
});

describe("padTiers", () => {
	it("widens a legacy six-box array to the world's depth", () => {
		withHeroLimit(7);
		const legacy = [false, false, true, false, false, false];
		const padded = padTiers(legacy);

		expect(padded).toHaveLength(8);
		expect(StatusTagData.tierOf(padded)).toBe(3);
	});

	it("never shrinks — a mark survives the Hero Limit dropping back", () => {
		withHeroLimit(5);
		const deep = [
			false,
			false,
			false,
			false,
			false,
			false,
			false,
			true, // tier 8, taken while the world ran deeper
		];
		const padded = padTiers(deep);

		expect(padded).toHaveLength(8);
		expect(StatusTagData.tierOf(padded)).toBe(8);
	});

	it("treats a missing array as an empty track", () => {
		withHeroLimit(5);
		expect(padTiers(undefined)).toEqual(Array(6).fill(false));
	});
});

describe("toTiers (story-tag sidebar form)", () => {
	it("keeps a partly-marked deep track when the Hero Limit drops back", () => {
		withHeroLimit(5);
		// Checkbox-style: unchecked boxes submit as null, so the array arrives at
		// its own length.
		const submitted = [null, "2", null, null, null, null, null, "8"];

		expect(toTiers(submitted)).toHaveLength(8);
		expect(StatusTagData.tierOf(toTiers(submitted))).toBe(8);
	});

	it("keeps a fully-marked deep track, which submits as bare tier numbers", () => {
		withHeroLimit(5);
		// Every box checked: nothing is null, so this is indistinguishable from
		// select-style input — and must still not shrink to the world's depth.
		const submitted = ["1", "2", "3", "4", "5", "6", "7", "8"];

		expect(toTiers(submitted)).toEqual(Array(8).fill(true));
	});

	it("sizes to the world's depth when the marks are shallower", () => {
		withHeroLimit(5);
		expect(toTiers(["3"])).toHaveLength(6);
		expect(toTiers([])).toEqual(Array(6).fill(false));
	});
});

describe("clampTier", () => {
	it("bounds to the world's track depth", () => {
		withHeroLimit(7);
		expect(clampTier(8)).toBe(8);
		expect(clampTier(9)).toBe(8);
		withHeroLimit(5);
		expect(clampTier(8)).toBe(6);
	});

	it("floors at 0 by default — 0 means skip this status", () => {
		withHeroLimit(5);
		expect(clampTier(-3)).toBe(0);
		expect(clampTier("nonsense")).toBe(0);
	});

	it("honours an explicit minimum", () => {
		withHeroLimit(5);
		expect(clampTier(0, { min: 1 })).toBe(1);
	});
});

describe("enricher markup at depth", () => {
	const classify = (text) =>
		classifyTagStringMatch([...text.matchAll(makeTagStringRe())][0]);

	it("reads [cursed-8] as a real tier-8 status in a deep world", () => {
		withHeroLimit(7);
		expect(classify("[cursed-8]")).toMatchObject({
			kind: "status",
			name: "cursed",
			tier: 8,
		});
	});

	it("still discards a tier past the world's depth as tier-less", () => {
		withHeroLimit(5);
		expect(classify("[cursed-8]")).toMatchObject({
			kind: "status",
			name: "cursed",
			tier: 0,
		});
	});
});

describe("marking deep tracks", () => {
	it("marks a tier past six once the world runs that deep", () => {
		withHeroLimit(7);
		const marked = StatusTagData.markTier(Array(6).fill(false), 8);

		expect(marked).toHaveLength(8);
		expect(StatusTagData.tierOf(marked)).toBe(8);
	});

	it("refuses a tier past the world's depth", () => {
		withHeroLimit(5);
		const marked = StatusTagData.markTier(Array(6).fill(false), 8);

		expect(StatusTagData.tierOf(marked)).toBe(0);
	});

	it("spills right into the deeper boxes when stacking", () => {
		withHeroLimit(7);
		const tiers = padTiers([false, false, false, false, false, true]); // 6
		const marked = StatusTagData.markTier(tiers, 6);

		expect(StatusTagData.tierOf(marked)).toBe(7);
	});

	it("pads rather than passing through when there is no tier to mark", () => {
		withHeroLimit(7);
		// Tier 0 is "no tier" — it still owes the caller a full-depth track, and
		// must not throw on an effect that has none stored yet.
		expect(StatusTagData.markTier(undefined, 0)).toEqual(Array(8).fill(false));
		expect(StatusTagData.markTier(Array(6).fill(false), 0)).toHaveLength(8);
	});

	it("oneHot sizes to the world's depth", () => {
		withHeroLimit(7);
		expect(StatusTagData.oneHot(8)).toHaveLength(8);
		expect(StatusTagData.tierOf(StatusTagData.oneHot(8))).toBe(8);
	});

	it("stacks separate tracks up past six", () => {
		withHeroLimit(7);
		const stacked = StatusTagData.stackedTier([
			padTiers([false, false, false, false, true]), // tier 5
			padTiers([false, false, false, false, true]), // tier 5 again
		]);

		expect(stacked).toBe(6);
	});
});
