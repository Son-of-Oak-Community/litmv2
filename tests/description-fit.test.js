import { describe, expect, it } from "vitest";
import { isDescriptionShort } from "../modules/sheets/description-fit.js";

describe("isDescriptionShort", () => {
	it("is short when content is below the clamp", () => {
		expect(isDescriptionShort(50, 96)).toBe(true);
	});
	it("is short at exactly the clamp height", () => {
		expect(isDescriptionShort(96, 96)).toBe(true);
	});
	it("is not short one pixel over the clamp", () => {
		expect(isDescriptionShort(97, 96)).toBe(false);
	});
	it("treats empty content as short", () => {
		expect(isDescriptionShort(0, 96)).toBe(true);
	});
});
