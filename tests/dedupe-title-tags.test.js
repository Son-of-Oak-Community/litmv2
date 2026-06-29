import { describe, expect, it } from "vitest";
import { dedupeTitleTags } from "../modules/active-effects/effect-queries.js";

const tag = (name, isTitleTag = false) => ({ name, system: { isTitleTag } });

describe("dedupeTitleTags", () => {
	it("keeps the first title tag and drops later ones", () => {
		const a = tag("title-a", true);
		const b = tag("power", false);
		const c = tag("title-b", true);

		expect(dedupeTitleTags([a, b, c])).toEqual([a, b]);
	});

	it("preserves order and all non-title tags", () => {
		const a = tag("one", false);
		const b = tag("title", true);
		const c = tag("two", false);

		expect(dedupeTitleTags([a, b, c])).toEqual([a, b, c]);
	});

	it("leaves a single title tag untouched", () => {
		const tags = [tag("title", true), tag("power", false)];
		expect(dedupeTitleTags(tags)).toEqual(tags);
	});

	it("handles an empty list", () => {
		expect(dedupeTitleTags([])).toEqual([]);
	});

	it("treats a missing system as a non-title tag", () => {
		const a = { name: "loose" };
		const b = tag("title", true);
		expect(dedupeTitleTags([a, b])).toEqual([a, b]);
	});
});
