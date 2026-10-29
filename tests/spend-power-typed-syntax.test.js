import { beforeAll, describe, expect, it, vi } from "vitest";
import { applyTypedTagSyntax } from "../modules/apps/spend-power.js";
import { makeTagStringRe } from "../modules/system/config.js";

// Spend Power's entry rows read tag markup like the sidebar's quick-add:
// typing "wet-3" to Inflict must not create a status literally named "wet-3".

vi.mock("../modules/apps/target-picker.js", () => ({
	getTargetCandidates: vi.fn(() => []),
}));
vi.mock("../modules/apps/story-tags/story-tags-store.js", () => ({
	StoryTagsStore: { loadStoryTags: vi.fn(async () => {}), packStoryTags: [] },
}));

beforeAll(() => {
	Object.defineProperty(CONFIG.litmv2, "tagStringRe", {
		configurable: true,
		get: () => makeTagStringRe(),
	});
});

function row(name, { tier, singleUse } = {}) {
	const parts = { ".litm-spend-power__entry-name": { value: name } };
	if (tier !== undefined) parts[".litm-spend-power__entry-tier"] = { value: tier };
	if (singleUse !== undefined)
		parts[".litm-spend-power__entry-single-use"] = { checked: singleUse };
	return { parts, querySelector: (selector) => parts[selector] ?? null };
}

describe("applyTypedTagSyntax", () => {
	it("moves a typed tier into a status row's tier box", () => {
		const r = row("wet-3", { tier: 1 });
		expect(applyTypedTagSyntax(r)).toBe(true);
		expect(r.parts[".litm-spend-power__entry-name"].value).toBe("wet");
		expect(r.parts[".litm-spend-power__entry-tier"].value).toBe(3);
	});

	it("ticks single-use for a typed '!' in a tag row", () => {
		const r = row("rope!", { singleUse: false });
		expect(applyTypedTagSyntax(r)).toBe(true);
		expect(r.parts[".litm-spend-power__entry-name"].value).toBe("rope");
		expect(r.parts[".litm-spend-power__entry-single-use"].checked).toBe(true);
	});

	it("leaves plain names and the other row kind's markup alone", () => {
		const plain = row("Dazed", { tier: 2 });
		expect(applyTypedTagSyntax(plain)).toBe(false);
		expect(plain.parts[".litm-spend-power__entry-tier"].value).toBe(2);

		const statusInTagRow = row("wet-3", { singleUse: false });
		expect(applyTypedTagSyntax(statusInTagRow)).toBe(false);
		expect(statusInTagRow.parts[".litm-spend-power__entry-name"].value).toBe(
			"wet-3",
		);
	});
});
