import { describe, expect, it } from "vitest";
import { classifyTagStringMatch } from "../modules/item/action/tag-string.js";
import { makeTagStringRe } from "../modules/system/config.js";

// classifyTagStringMatch is the shared "what kind of tag is this" helper used
// by the Challenge/Journey tag-string sync and the story-tag sidebar drag
// handler. Both used to hand-roll the destructuring and both forgot the
// `exclamation` capture group, which shifted separator/value by one and
// silently turned `[name-tier]` statuses into plain story tags
// (the "[restrained-4] becomes [restrained]" bug).

const classify = (text) => {
	const match = [...text.matchAll(makeTagStringRe())][0];
	return classifyTagStringMatch(match);
};

describe("classifyTagStringMatch", () => {
	it("classifies [name-tier] as a status with the right tier", () => {
		expect(classify("[restrained-4]")).toMatchObject({
			name: "restrained",
			isStatus: true,
			tier: 4,
		});
	});

	it("keeps a single-use [name!] as a story tag, not a status", () => {
		// Regression: the forgotten exclamation group made `separator` read the
		// `!` and misclassify single-use story tags.
		expect(classify("[silver dagger!]")).toMatchObject({
			name: "silver dagger",
			isStatus: false,
			tier: 0,
		});
	});

	it("classifies a plain [name] as a story tag", () => {
		expect(classify("[lantern]")).toMatchObject({
			name: "lantern",
			isStatus: false,
			tier: 0,
		});
	});

	it("treats the colon separator [name:N] as a story tag (limit syntax)", () => {
		expect(classify("[Limit:3]")).toMatchObject({
			name: "Limit",
			isStatus: false,
		});
	});

	it("handles variable-tier [name-] (status, tier 0)", () => {
		expect(classify("[wounded-]")).toMatchObject({
			name: "wounded",
			isStatus: true,
			tier: 0,
		});
	});

	it("preserves internal whitespace in status names", () => {
		expect(classify("[Tired Out-3]")).toMatchObject({
			name: "Tired Out",
			isStatus: true,
			tier: 3,
		});
	});
});
