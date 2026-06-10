import { describe, expect, it } from "vitest";
import {
	parseTagString,
	parseTagStringMatch,
} from "../modules/item/action/tag-string.js";
import { makeTagStringRe } from "../modules/system/config.js";

// parseTagStringMatch consumes the regex-match shape:
//   [full, name, exclamation, separator, value]
// These tests pin down behaviour at the awkward boundaries: out-of-range tiers,
// non-numeric values, names with whitespace, single-use markers, and the
// enricher-only kinds (weakness/limit) that produce no effect data.

describe("parseTagStringMatch edge cases", () => {
	it("tier 0 produces an all-false tier array (out-of-range)", () => {
		const data = parseTagStringMatch(["[X-0]", "X", undefined, "-", "0"]);
		expect(data.type).toBe("status_tag");
		expect(data.system.tiers).toEqual([
			false,
			false,
			false,
			false,
			false,
			false,
		]);
	});

	it("tier 7 produces an all-false tier array (out-of-range)", () => {
		const data = parseTagStringMatch(["[X-7]", "X", undefined, "-", "7"]);
		expect(data.system.tiers).toEqual([
			false,
			false,
			false,
			false,
			false,
			false,
		]);
	});

	it("non-numeric tier value falls back to 0 / all-false", () => {
		const data = parseTagStringMatch(["[X-abc]", "X", undefined, "-", "abc"]);
		expect(data.system.tiers.every((v) => v === false)).toBe(true);
	});

	it("preserves internal whitespace in the tag name", () => {
		const status = parseTagStringMatch([
			"[Tired Out-3]",
			"Tired Out",
			undefined,
			"-",
			"3",
		]);
		expect(status.name).toBe("Tired Out");
		expect(status.type).toBe("status_tag");

		const story = parseTagStringMatch([
			"[Tired Out]",
			"Tired Out",
			undefined,
			"",
			"",
		]);
		expect(story.name).toBe("Tired Out");
		expect(story.type).toBe("story_tag");
	});

	it("returns null for limit markup [name:N] — limits are not effects", () => {
		const data = parseTagStringMatch([
			"[Suspicion:3]",
			"Suspicion",
			undefined,
			":",
			"3",
		]);
		expect(data).toBeNull();
	});

	it("returns null for legacy [name:1] — no longer a single-use story tag", () => {
		const data = parseTagStringMatch([
			"[Lucky Charm:1]",
			"Lucky Charm",
			undefined,
			":",
			"1",
		]);
		expect(data).toBeNull();
	});

	it("returns null for weakness markup [-name] — weaknesses are not parsed here", () => {
		const data = parseTagStringMatch([
			"[-Cowardly]",
			"-Cowardly",
			undefined,
			"",
			"",
		]);
		expect(data).toBeNull();
	});

	it("treats [name!] as a single-use story tag", () => {
		const re = makeTagStringRe();
		const matches = [..."[silver dagger!]".matchAll(re)];
		expect(matches).toHaveLength(1);
		const data = parseTagStringMatch(matches[0]);
		expect(data.type).toBe("story_tag");
		expect(data.name).toBe("silver dagger");
		expect(data.system.isSingleUse).toBe(true);
	});

	it("regex still parses [name] without `!` as a regular tag", () => {
		const re = makeTagStringRe();
		const matches = [..."[map]".matchAll(re)];
		expect(matches[0][1]).toBe("map");
		expect(matches[0][2]).toBeUndefined();
		const data = parseTagStringMatch(matches[0]);
		expect(data.system.isSingleUse).toBe(false);
	});

	it("regex parses [name-N] for status with tier", () => {
		const re = makeTagStringRe();
		const matches = [..."[wounded-2]".matchAll(re)];
		const data = parseTagStringMatch(matches[0]);
		expect(data.type).toBe("status_tag");
		expect(data.system.tiers).toEqual([
			false,
			true,
			false,
			false,
			false,
			false,
		]);
	});

	it("regex parses [name-] as variable-tier (all-false)", () => {
		const re = makeTagStringRe();
		const matches = [..."[wounded-]".matchAll(re)];
		const data = parseTagStringMatch(matches[0]);
		expect(data.type).toBe("status_tag");
		expect(data.system.tiers.every((v) => v === false)).toBe(true);
	});
});

describe("parseTagString", () => {
	it("parses every effect-producing token and skips enricher-only kinds", () => {
		const data = parseTagString(
			"Gain [aim] and [smoke bomb!], suffer [wounded-2]; [-Cowardly] and [Suspicion:3] render chips only.",
		);
		expect(data).toEqual([
			{
				name: "aim",
				type: "story_tag",
				system: { isScratched: false, isSingleUse: false },
			},
			{
				name: "smoke bomb",
				type: "story_tag",
				system: { isScratched: false, isSingleUse: true },
			},
			{
				name: "wounded",
				type: "status_tag",
				system: { tiers: [false, true, false, false, false, false] },
			},
		]);
	});

	it("returns [] for empty input and brace-wrapped (unsupported) markup", () => {
		expect(parseTagString("")).toEqual([]);
		expect(parseTagString(null)).toEqual([]);
		expect(parseTagString("{map} {wounded-2}")).toEqual([]);
	});
});
