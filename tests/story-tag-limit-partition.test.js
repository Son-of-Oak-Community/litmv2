import { describe, expect, it } from "vitest";
import { partitionTagsByLimit } from "../modules/apps/story-tags/story-tag-helpers.js";

const tiers = (n) => Array.from({ length: 6 }, (_, i) => i + 1 === n);

const statusTag = (n, limitId = "lim-1") => ({
	id: `tag-${n}-${limitId}`,
	type: "status_tag",
	limitId,
	values: tiers(n),
});

// The sidebar reads `computedValue`, not the stored `value`, so it has to agree
// with what the recalc stores: the statuses plus any Advance offset.
describe("partitionTagsByLimit computedValue", () => {
	it("counts the statuses linked to the limit", () => {
		const { limits } = partitionTagsByLimit(
			[statusTag(2), statusTag(5, "other")],
			[{ id: "lim-1", max: 3 }],
		);
		expect(limits[0].computedValue).toBe(2);
	});

	it("adds what Advance left on the limit", () => {
		const { limits } = partitionTagsByLimit(
			[statusTag(1)],
			[{ id: "lim-1", max: 4, advanced: 2 }],
		);
		expect(limits[0].computedValue).toBe(3);
	});

	it("shows an Advance on a limit with no statuses at all", () => {
		const { limits } = partitionTagsByLimit(
			[],
			[{ id: "lim-1", max: 4, advanced: 2 }],
		);
		expect(limits[0].computedValue).toBe(2);
	});

	it("subtracts a Set Back without going below zero", () => {
		const { limits } = partitionTagsByLimit(
			[statusTag(2)],
			[{ id: "lim-1", max: 4, advanced: -5 }],
		);
		expect(limits[0].computedValue).toBe(0);
	});
});

describe("partitionTagsByLimit and hidden statuses", () => {
	const hiddenStatus = {
		id: "s1",
		type: "status_tag",
		limitId: "lim",
		hidden: true,
		values: [false, false, true, false, false, false],
	};
	const limits = [{ id: "lim", max: 4 }];

	it("leaves a hidden status out of a player-owned actor's value, matching the recalc", () => {
		const { limits: out } = partitionTagsByLimit([hiddenStatus], limits, {
			actor: { hasPlayerOwner: true },
		});
		expect(out[0].computedValue).toBe(0);
		expect(out[0].tags).toEqual([hiddenStatus]);
	});

	it("counts it on an actor no player owns", () => {
		const { limits: out } = partitionTagsByLimit([hiddenStatus], limits, {
			actor: { hasPlayerOwner: false },
		});
		expect(out[0].computedValue).toBe(3);
	});
});
