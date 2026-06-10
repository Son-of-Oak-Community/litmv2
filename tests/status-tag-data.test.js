import { describe, expect, it } from "vitest";
import { StatusTagData } from "../modules/active-effects/status-tag-data.js";

const empty = () => [false, false, false, false, false, false];

describe("StatusTagData.markTier", () => {
	it("marks the requested tier when empty", () => {
		expect(StatusTagData.markTier(empty(), 3)).toEqual([
			false,
			false,
			true,
			false,
			false,
			false,
		]);
	});

	it("shifts to the next free slot when the requested tier is already on", () => {
		const tiers = [false, false, true, false, false, false];
		expect(StatusTagData.markTier(tiers, 3)).toEqual([
			false,
			false,
			true,
			true,
			false,
			false,
		]);
	});

	it("is a no-op when the tier is out of range", () => {
		const tiers = empty();
		expect(StatusTagData.markTier(tiers, 7)).toEqual(empty());
		expect(StatusTagData.markTier(tiers, 0)).toEqual(empty());
	});

	it("does not mutate the input array", () => {
		const tiers = empty();
		StatusTagData.markTier(tiers, 2);
		expect(tiers).toEqual(empty());
	});
});

describe("StatusTagData.stackedTier", () => {
	it("returns the highest single-array tier when only one is present", () => {
		expect(
			StatusTagData.stackedTier([[false, false, true, false, false, false]]),
		).toBe(3);
	});

	it("shifts overlapping tiers right and returns the new highest", () => {
		// Two statuses both at tier 2 → second one shifts to tier 3 → highest is 3
		const a = [false, true, false, false, false, false];
		const b = [false, true, false, false, false, false];
		expect(StatusTagData.stackedTier([a, b])).toBe(3);
	});

	it("returns 0 when no tiers are set", () => {
		expect(StatusTagData.stackedTier([empty(), empty()])).toBe(0);
	});
});

describe("StatusTagData#calculateReduction", () => {
	it("shifts marked tiers down by the given amount", () => {
		const status = new StatusTagData({
			tiers: [false, false, false, true, false, false],
		});
		expect(status.calculateReduction(2)).toEqual([
			false,
			true,
			false,
			false,
			false,
			false,
		]);
	});

	it("drops tiers that would fall below 1", () => {
		const status = new StatusTagData({
			tiers: [true, false, false, false, false, false],
		});
		expect(status.calculateReduction(2)).toEqual(empty());
	});
});

describe("StatusTagData#calculateMark", () => {
	it("delegates to the static markTier with this.tiers", () => {
		const status = new StatusTagData({ tiers: empty() });
		expect(status.calculateMark(3)).toEqual([
			false,
			false,
			true,
			false,
			false,
			false,
		]);
	});

	it("shifts to the next free slot when the requested tier is occupied", () => {
		const status = new StatusTagData({
			tiers: [false, false, true, false, false, false],
		});
		expect(status.calculateMark(3)).toEqual([
			false,
			false,
			true,
			true,
			false,
			false,
		]);
	});
});

describe("StatusTagData#currentTier", () => {
	it("returns the highest set tier (1-indexed)", () => {
		expect(
			new StatusTagData({ tiers: [false, false, true, false, false, false] })
				.currentTier,
		).toBe(3);
		expect(
			new StatusTagData({ tiers: [true, true, true, true, true, true] })
				.currentTier,
		).toBe(6);
	});

	it("returns 0 when nothing is marked", () => {
		expect(new StatusTagData({ tiers: empty() }).currentTier).toBe(0);
	});

	it("value mirrors currentTier", () => {
		const status = new StatusTagData({
			tiers: [false, true, false, false, false, false],
		});
		expect(status.value).toBe(status.currentTier);
	});
});

describe("StatusTagData#toTagString", () => {
	it("formats as [name-tier] using currentTier", () => {
		const status = new StatusTagData({
			tiers: [false, false, true, false, false, false],
		});
		expect(status.toTagString("Tired")).toBe("[Tired-3]");
	});

	it("uses tier 0 when nothing is marked", () => {
		const status = new StatusTagData({ tiers: empty() });
		expect(status.toTagString("Empty")).toBe("[Empty-0]");
	});
});

describe("StatusTagData.oneHot", () => {
	it("marks exactly the given tier", () => {
		expect(StatusTagData.oneHot(2)).toEqual([
			false,
			true,
			false,
			false,
			false,
			false,
		]);
	});

	it("yields a tier-less array for out-of-range tiers", () => {
		expect(StatusTagData.oneHot(0)).toEqual(empty());
		expect(StatusTagData.oneHot(7)).toEqual(empty());
	});
});
