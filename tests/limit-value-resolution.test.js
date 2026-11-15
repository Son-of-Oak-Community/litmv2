import { describe, expect, it } from "vitest";
import { resolveLimitValue } from "../modules/actor/mixins/actor-limits.js";

// actor-limits.js: "A limit's value: what its linked statuses stack to, plus the
// offset Advance and Set Back left on it (`limit.advanced`, 0 when the limit has
// none)... A Set Back can only take back what is there, so the offset is floored
// at the negative of the statuses' value. Once the statuses are gone, the
// surplus Set Back goes with them instead of discounting a status that lands
// later." CLAUDE.md: `advanced` "default 0, may be negative".
//
// `toBe` compares with Object.is, so a stray -0 in `value` or `advanced` fails.

describe("resolveLimitValue", () => {
	it("is the statuses' stack when the limit carries no offset", () => {
		expect(resolveLimitValue({}, 3)).toEqual({ value: 3, advanced: 0 });
		expect(resolveLimitValue({ advanced: undefined }, 3)).toEqual({
			value: 3,
			advanced: 0,
		});
		expect(resolveLimitValue({ advanced: null }, 3)).toEqual({
			value: 3,
			advanced: 0,
		});
	});

	it("adds an Advance offset on top of the statuses", () => {
		expect(resolveLimitValue({ advanced: 2 }, 3)).toEqual({
			value: 5,
			advanced: 2,
		});
	});

	it("lets an Advance stand alone on a limit with no statuses", () => {
		expect(resolveLimitValue({ advanced: 4 }, 0)).toEqual({
			value: 4,
			advanced: 4,
		});
	});

	it("subtracts a Set Back the statuses can cover, keeping the offset", () => {
		expect(resolveLimitValue({ advanced: -1 }, 4)).toEqual({
			value: 3,
			advanced: -1,
		});
	});

	it("takes a Set Back down to exactly zero and no further", () => {
		expect(resolveLimitValue({ advanced: -4 }, 4)).toEqual({
			value: 0,
			advanced: -4,
		});
	});

	it("floors a Set Back at what the statuses hold", () => {
		const result = resolveLimitValue({ advanced: -5 }, 2);
		expect(result.advanced).toBe(-2);
		expect(result.value).toBe(0);
	});

	it("drops the whole Set Back once no status is left, and never yields -0", () => {
		const result = resolveLimitValue({ advanced: -3 }, 0);
		expect(result.advanced).toBe(0);
		expect(result.value).toBe(0);
	});

	it("does not discount a status that lands after the surplus Set Back is gone", () => {
		// The recalc persists the offset it returned; the next status change
		// feeds it back in.
		const empty = resolveLimitValue({ advanced: -3 }, 0);
		const later = resolveLimitValue({ advanced: empty.advanced }, 3);
		expect(later).toEqual({ value: 3, advanced: 0 });
	});

	it("keeps a Set Back across status changes while there is something to set back", () => {
		let limit = { advanced: -2 };
		const steps = [];
		for (const statusValue of [3, 5, 1, 0, 4]) {
			const { value, advanced } = resolveLimitValue(limit, statusValue);
			steps.push({ statusValue, value, advanced });
			limit = { advanced };
		}
		expect(steps).toEqual([
			{ statusValue: 3, value: 1, advanced: -2 },
			{ statusValue: 5, value: 3, advanced: -2 },
			// Fewer statuses than the Set Back: it shrinks to match...
			{ statusValue: 1, value: 0, advanced: -1 },
			{ statusValue: 0, value: 0, advanced: 0 },
			// ...and is gone for good, so the next status counts in full.
			{ statusValue: 4, value: 4, advanced: 0 },
		]);
	});

	it("does not touch the stored limit", () => {
		const limit = { id: "l1", max: 6, advanced: -5 };
		resolveLimitValue(limit, 2);
		expect(limit).toEqual({ id: "l1", max: 6, advanced: -5 });
	});
});
