import { describe, expect, it } from "vitest";
import {
	FELLOWSHIP_KEY as F,
	fellowshipSlot,
	moveCard,
} from "../modules/sheets/card-order.js";

describe("fellowshipSlot", () => {
	it("defaults to last when unset", () => {
		expect(fellowshipSlot(undefined, 4)).toBe(4);
	});

	it("clamps a stale slot to the theme count", () => {
		expect(fellowshipSlot(4, 2)).toBe(2);
		expect(fellowshipSlot(-1, 2)).toBe(0);
	});
});

describe("moveCard", () => {
	const row = ["a", "b", F, "c", "d"];

	it("moves a theme past the Fellowship, shifting it", () => {
		expect(moveCard(row, "a", "c")).toEqual(["b", F, "c", "a", "d"]);
		expect(moveCard(row, "d", "a")).toEqual(["d", "a", "b", F, "c"]);
	});

	it("drops a theme onto the Fellowship card", () => {
		expect(moveCard(row, "a", F)).toEqual(["b", F, "a", "c", "d"]);
		expect(moveCard(row, "d", F)).toEqual(["a", "b", "d", F, "c"]);
	});

	it("moves the Fellowship like any card", () => {
		expect(moveCard(row, F, "a")).toEqual([F, "a", "b", "c", "d"]);
		expect(moveCard(row, F, "d")).toEqual(["a", "b", "c", "d", F]);
	});

	it("does nothing on itself or an unknown card", () => {
		expect(moveCard(row, "a", "a")).toBeNull();
		expect(moveCard(row, "a", "zz")).toBeNull();
	});
});
