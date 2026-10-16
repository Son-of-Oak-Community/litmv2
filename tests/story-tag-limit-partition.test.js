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
