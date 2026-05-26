import { describe, expect, it } from "vitest";
import { LitmRoll } from "../modules/apps/roll/roll.js";

const tag = (overrides = {}) => ({
	type: "story_tag",
	state: "positive",
	...overrides,
});

describe("LitmRoll.filterTags", () => {
	it("partitions a mixed selection into all five buckets", () => {
		const result = LitmRoll.filterTags([
			tag({ type: "power_tag", state: "positive", name: "fierce" }),
			tag({ type: "weakness_tag", state: "negative", name: "proud" }),
			tag({ type: "story_tag", state: "scratched", name: "blessed" }),
			tag({ type: "status_tag", state: "positive", name: "rested" }),
			tag({ type: "status_tag", state: "negative", name: "tired" }),
		]);

		expect(result.powerTags.map((t) => t.name)).toEqual(["fierce"]);
		expect(result.weaknessTags.map((t) => t.name)).toEqual(["proud"]);
		expect(result.scratchedTags.map((t) => t.name)).toEqual(["blessed"]);
		expect(result.positiveStatuses.map((t) => t.name)).toEqual(["rested"]);
		expect(result.negativeStatuses.map((t) => t.name)).toEqual(["tired"]);
	});

	it("excludes status tags from powerTags/weaknessTags", () => {
		const result = LitmRoll.filterTags([
			tag({ type: "status_tag", state: "positive" }),
			tag({ type: "status_tag", state: "negative" }),
		]);

		expect(result.powerTags).toEqual([]);
		expect(result.weaknessTags).toEqual([]);
	});

	it("treats scratched precedence: a scratched tag is scratched, not positive", () => {
		// scratchedTags filter pulls by state alone, so a power_tag in scratched
		// state lands in scratchedTags but not in powerTags.
		const t = tag({ type: "power_tag", state: "scratched", name: "burned" });
		const result = LitmRoll.filterTags([t]);

		expect(result.scratchedTags).toEqual([t]);
		expect(result.powerTags).toEqual([]);
	});

	it("returns empty arrays (not undefined) for an empty input", () => {
		expect(LitmRoll.filterTags([])).toEqual({
			scratchedTags: [],
			powerTags: [],
			weaknessTags: [],
			positiveStatuses: [],
			negativeStatuses: [],
		});
	});

	it("drops scratched tags whose data model says canBurn === false", () => {
		// Defence-in-depth: even if a fellowship_tag (or other non-burnable
		// effect) somehow reaches state="scratched" through out-of-spec data,
		// it must not yield the burn bonus. This prevents the recurring
		// 'fellowship title tag burnable for +3' regression.
		const result = LitmRoll.filterTags([
			tag({
				type: "fellowship_tag",
				state: "scratched",
				system: { canBurn: false },
				name: "fellowship-title",
			}),
			tag({
				type: "power_tag",
				state: "scratched",
				system: { canBurn: true },
				name: "real-burn",
			}),
		]);

		expect(result.scratchedTags.map((t) => t.name)).toEqual(["real-burn"]);
	});

	it("calculatePower consumes filterTags output without re-shaping", () => {
		const filtered = LitmRoll.filterTags([
			tag({ type: "power_tag", state: "positive" }),
			tag({ type: "weakness_tag", state: "negative" }),
		]);

		// The roll dialog flow is: selection -> filterTags -> calculatePower.
		// This locks in that contract: shapes line up without an adapter layer.
		const { totalPower } = LitmRoll.calculatePower({
			...filtered,
			modifier: 0,
			might: 0,
		});
		expect(totalPower).toBe(0);
	});
});
