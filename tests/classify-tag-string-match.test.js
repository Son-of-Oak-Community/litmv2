import { describe, expect, it } from "vitest";
import { classifyTagStringMatch } from "../modules/item/action/tag-string.js";
import { makeTagStringRe } from "../modules/system/config.js";

// classifyTagStringMatch is the single semantic layer for tag markup, used
// by the enricher, the chip drag handlers, the Challenge/Journey tag-string
// sync, and the markup scanners. It is the only place that destructures the
// regex match — hand-rolled destructuring used to forget the `exclamation`
// capture group, which shifted separator/value by one and silently turned
// `[name-tier]` statuses into plain story tags
// (the "[restrained-4] becomes [restrained]" bug).

const classify = (text) => {
	const match = [...text.matchAll(makeTagStringRe())][0];
	return classifyTagStringMatch(match);
};

describe("classifyTagStringMatch", () => {
	it("classifies [name-tier] as a status with the right tier", () => {
		expect(classify("[restrained-4]")).toMatchObject({
			kind: "status",
			name: "restrained",
			tier: 4,
		});
	});

	it("classifies [name!] as a single-use story tag, not a status", () => {
		// Regression: the forgotten exclamation group made `separator` read the
		// `!` and misclassify single-use story tags.
		expect(classify("[silver dagger!]")).toMatchObject({
			kind: "story",
			name: "silver dagger",
			isSingleUse: true,
			tier: 0,
		});
	});

	it("classifies a plain [name] as a story tag", () => {
		expect(classify("[lantern]")).toMatchObject({
			kind: "story",
			name: "lantern",
			isSingleUse: false,
			tier: 0,
		});
	});

	it("classifies [name:N] as a limit", () => {
		expect(classify("[Suspicion:3]")).toMatchObject({
			kind: "limit",
			name: "Suspicion",
			value: "3",
		});
	});

	it("classifies [name:1] as a limit too (legacy single-use syntax removed)", () => {
		expect(classify("[Lucky Charm:1]")).toMatchObject({
			kind: "limit",
			name: "Lucky Charm",
			value: "1",
			isSingleUse: false,
		});
	});

	it("classifies [-name] as a weakness with the dash stripped", () => {
		expect(classify("[-Cowardly]")).toMatchObject({
			kind: "weakness",
			name: "Cowardly",
		});
	});

	it("handles variable-tier [name-] (status, tier 0)", () => {
		expect(classify("[wounded-]")).toMatchObject({
			kind: "status",
			name: "wounded",
			tier: 0,
		});
	});

	it("clamps out-of-range status tiers to 0 (variable)", () => {
		expect(classify("[wounded-7]")).toMatchObject({
			kind: "status",
			tier: 0,
			value: "7",
		});
	});

	it("preserves internal whitespace in status names", () => {
		expect(classify("[Tired Out-3]")).toMatchObject({
			kind: "status",
			name: "Tired Out",
			tier: 3,
		});
	});

	it("no longer matches tags wrapped in curly braces", () => {
		expect([..."{map}".matchAll(makeTagStringRe())]).toHaveLength(0);
		expect([..."{wounded-2}".matchAll(makeTagStringRe())]).toHaveLength(0);
	});
});
