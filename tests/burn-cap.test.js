import { describe, expect, it } from "vitest";
import {
	findBurnedSelection,
	nextStateAfterScratched,
} from "../modules/apps/roll/burn-cap.js";

/**
 * Burn cap (Core Book p.158): at most one tag may be burned ("scratched") per
 * roll. Two helpers enforce it from three entry points (dialog cycle, dialog
 * shift-burn, sheet shift-burn):
 *
 *  - `findBurnedSelection` answers "is some OTHER tag already burned?"
 *  - `nextStateAfterScratched` lets the natural cycle skip past the blocked
 *    scratched waypoint instead of being trapped — critical because the GM
 *    power-tag cycle is `,positive,scratched,negative`, so "negative" sits
 *    AFTER "scratched" and must stay reachable while another tag is burned.
 */

const mapOf = (entries) => new Map(Object.entries(entries));

describe("findBurnedSelection", () => {
	it("returns the id of an already-burned tag other than the excluded one", () => {
		const map = mapOf({
			a: { state: "positive" },
			b: { state: "scratched" },
		});
		expect(findBurnedSelection(map, "a")).toBe("b");
	});

	it("ignores the excluded id so a tag can be (re)burned or toggled off", () => {
		const map = mapOf({ b: { state: "scratched" } });
		expect(findBurnedSelection(map, "b")).toBe(null);
	});

	it("returns null when no tag is burned", () => {
		const map = mapOf({ a: { state: "positive" }, b: { state: "negative" } });
		expect(findBurnedSelection(map, "a")).toBe(null);
	});

	it("returns null for an empty selection map", () => {
		expect(findBurnedSelection(new Map(), "a")).toBe(null);
	});
});

describe("nextStateAfterScratched", () => {
	it("advances to negative for the GM power-tag cycle (scratched is a waypoint)", () => {
		// ",positive,scratched,negative" → ["", "positive", "scratched", "negative"]
		const states = ["", "positive", "scratched", "negative"];
		expect(nextStateAfterScratched(states)).toBe("negative");
	});

	it("wraps to off for the player power-tag cycle (scratched is last)", () => {
		// ",positive,scratched" → ["", "positive", "scratched"]
		const states = ["", "positive", "scratched"];
		expect(nextStateAfterScratched(states)).toBe("");
	});

	it("wraps to off for the multi-use story-tag cycle (scratched is last)", () => {
		// ",positive,negative,scratched" → ["", "positive", "negative", "scratched"]
		const states = ["", "positive", "negative", "scratched"];
		expect(nextStateAfterScratched(states)).toBe("");
	});

	it("returns off when the cycle has no scratched state", () => {
		expect(nextStateAfterScratched(["", "positive", "negative"])).toBe("");
	});
});
