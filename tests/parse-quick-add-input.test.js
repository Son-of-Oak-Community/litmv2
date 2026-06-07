import { describe, expect, it } from "vitest";
import { parseQuickAddInput } from "../modules/apps/story-tags/story-tag-helpers.js";

// parseQuickAddInput parses the bracket-less quick-add inputs (story-tag
// sidebar and scene-tag dialog). It wraps the raw text in brackets and
// delegates to the canonical classifyTagString, so these tests pin the
// contract that quick-add and bracket markup agree on every suffix.

describe("parseQuickAddInput", () => {
	it("returns null for empty input", () => {
		expect(parseQuickAddInput("")).toBeNull();
		expect(parseQuickAddInput(null)).toBeNull();
	});

	it("parses plain text as a story tag", () => {
		expect(parseQuickAddInput("rope")).toEqual({
			type: "story_tag",
			name: "rope",
			isSingleUse: false,
		});
	});

	it("parses a ! suffix as a single-use story tag", () => {
		expect(parseQuickAddInput("torch!")).toEqual({
			type: "story_tag",
			name: "torch",
			isSingleUse: true,
		});
	});

	it("parses -N as a status with that tier", () => {
		expect(parseQuickAddInput("wounded-3")).toEqual({
			type: "status_tag",
			name: "wounded",
			tier: 3,
		});
	});

	it("parses an out-of-range tier as a tier-less status (bracket semantics)", () => {
		// The old hand-rolled parser fell through to a story tag named
		// "wounded-9"; the canonical classifier keeps it a status.
		expect(parseQuickAddInput("wounded-9")).toEqual({
			type: "status_tag",
			name: "wounded",
			tier: 0,
		});
	});

	it("parses a bare dash suffix as a tier-less status", () => {
		expect(parseQuickAddInput("dazed-")).toEqual({
			type: "status_tag",
			name: "dazed",
			tier: 0,
		});
	});

	it("parses :N as a limit with that max", () => {
		expect(parseQuickAddInput("escape:4")).toEqual({
			type: "limit",
			name: "escape",
			limitMax: 4,
		});
	});

	it("parses a bare colon suffix as an unbounded limit", () => {
		expect(parseQuickAddInput("doom:")).toEqual({
			type: "limit",
			name: "doom",
			limitMax: null,
		});
	});

	it("trims whitespace between name and suffix", () => {
		expect(parseQuickAddInput("guard the door :3")).toEqual({
			type: "limit",
			name: "guard the door",
			limitMax: 3,
		});
	});

	it("keeps weakness-style input as a literal story tag", () => {
		// Quick-add can't create weakness effects, so "-name" stays verbatim.
		expect(parseQuickAddInput("-craven")).toEqual({
			type: "story_tag",
			name: "-craven",
		});
	});

	it("falls back to a literal story tag for names the grammar can't express", () => {
		// Digits are excluded from tag names by the bracket regex.
		expect(parseQuickAddInput("level 2")).toEqual({
			type: "story_tag",
			name: "level 2",
		});
		// Brackets in the input would truncate the wrapped parse.
		expect(parseQuickAddInput("a]b")).toEqual({
			type: "story_tag",
			name: "a]b",
		});
	});

	it("parses suffixes on digit-containing names the bracket grammar rejects", () => {
		// The bracket regex bans digits in names, but quick-add doesn't —
		// the suffix fallback keeps "room 2:4" a limit.
		expect(parseQuickAddInput("room 2:4")).toEqual({
			type: "limit",
			name: "room 2",
			limitMax: 4,
		});
		expect(parseQuickAddInput("level 2-3")).toEqual({
			type: "status_tag",
			name: "level 2",
			tier: 3,
		});
		expect(parseQuickAddInput("level 2!")).toEqual({
			type: "story_tag",
			name: "level 2",
			isSingleUse: true,
		});
	});

	it("keeps out-of-range tiers on digit names literal in the fallback", () => {
		// The canonical path normalizes out-of-range tiers to tier-less
		// statuses ("wounded-9" above); the fallback stays conservative —
		// a digit name with a digit suffix outside 1-6 is just a name.
		expect(parseQuickAddInput("level 2-9")).toEqual({
			type: "story_tag",
			name: "level 2-9",
		});
	});
});
