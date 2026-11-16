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
	// Every tier the track can't hold is tier-less: 0, past the depth,
	// non-numeric, and the variable `[name-]`.
	it.each([
		["0", "[X-0]"],
		["7", "[X-7]"],
		["abc", "[X-abc]"],
		["", "[X-]"],
	])("tier %j produces a status with no box marked", (value, full) => {
		const data = parseTagStringMatch([full, "X", undefined, "-", value]);
		expect(data.type).toBe("status_tag");
		expect(data.system.tiers).toEqual(Array(6).fill(false));
	});

	it("preserves internal whitespace in a story tag name", () => {
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

	// `[name:1]` was once a single-use story tag; it is a limit like any other.
	it.each([
		["[Suspicion:3]", "Suspicion", "3"],
		["[Lucky Charm:1]", "Lucky Charm", "1"],
	])(
		"returns null for limit markup %s — limits are not effects",
		(full, name, max) => {
			expect(parseTagStringMatch([full, name, undefined, ":", max])).toBeNull();
		},
	);

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
