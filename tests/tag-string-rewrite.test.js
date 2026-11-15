import { describe, expect, it } from "vitest";
import {
	removeFromTagString,
	retierInTagString,
} from "../modules/item/action/tag-string.js";

// A Challenge's `system.tags` string is rewritten whenever one of its effects
// changes in play mode. The string is what edit mode saves back, so a rewrite
// that misses loses the change on the next mode switch, and one that hits the
// wrong token corrupts the string.

describe("retierInTagString", () => {
	it("marks a new tier on a status", () => {
		expect(retierInTagString("[wounded-1], [fog]", "wounded", 3)).toBe(
			"[wounded-3], [fog]",
		);
	});

	it("marks a tier on a status written without one", () => {
		expect(retierInTagString("[wounded-], [fog]", "wounded", 2)).toBe(
			"[wounded-2], [fog]",
		);
	});

	it("writes a status with no tier left as tier-less", () => {
		expect(retierInTagString("[wounded-2]", "wounded", 0)).toBe("[wounded-]");
	});

	it("leaves a limit of the same name alone", () => {
		expect(retierInTagString("[storm:3], [storm-1]", "storm", 2)).toBe(
			"[storm:3], [storm-2]",
		);
	});

	it("leaves a story tag of the same name alone", () => {
		expect(retierInTagString("[storm], [storm-1]", "storm", 2)).toBe(
			"[storm], [storm-2]",
		);
	});

	it("matches the name whatever its case, and keeps it as typed", () => {
		expect(retierInTagString("[Wounded-1]", "wounded", 4)).toBe("[Wounded-4]");
	});

	it("does not match a longer name that starts the same", () => {
		expect(retierInTagString("[wounded badly-1]", "wounded", 4)).toBe(
			"[wounded badly-1]",
		);
	});

	it("handles a name with regex characters in it", () => {
		expect(retierInTagString("[lost (again)-1]", "lost (again)", 2)).toBe(
			"[lost (again)-2]",
		);
	});

	it("returns the string untouched when the status is not in it", () => {
		const tags = "[fog], [storm:3]";
		expect(retierInTagString(tags, "wounded", 2)).toBe(tags);
		expect(retierInTagString("", "wounded", 2)).toBe("");
	});

	it("rewrites only the first of two same-named statuses", () => {
		expect(retierInTagString("[hurt-1], [hurt-2]", "hurt", 3)).toBe(
			"[hurt-3], [hurt-2]",
		);
	});
});

describe("removeFromTagString", () => {
	it("removes a story tag and tidies the separators", () => {
		expect(removeFromTagString("[fog], [rope], [lamp]", "story", "rope")).toBe(
			"[fog], [lamp]",
		);
		expect(removeFromTagString("[rope], [lamp]", "story", "rope")).toBe(
			"[lamp]",
		);
		expect(removeFromTagString("[fog], [rope]", "story", "rope")).toBe("[fog]");
		expect(removeFromTagString("[rope]", "story", "rope")).toBe("");
	});

	it("removes a single-use story tag", () => {
		expect(removeFromTagString("[rope!], [fog]", "story", "rope")).toBe(
			"[fog]",
		);
	});

	it("removes a status, with or without a tier", () => {
		expect(removeFromTagString("[wounded-2], [fog]", "status", "wounded")).toBe(
			"[fog]",
		);
		expect(removeFromTagString("[wounded-], [fog]", "status", "wounded")).toBe(
			"[fog]",
		);
	});

	it("removing a story tag leaves a limit and a status of that name", () => {
		expect(
			removeFromTagString("[storm:3], [storm], [storm-1]", "story", "storm"),
		).toBe("[storm:3], [storm-1]");
	});

	it("removing a status leaves a story tag and a limit of that name", () => {
		expect(
			removeFromTagString("[storm:3], [storm], [storm-1]", "status", "storm"),
		).toBe("[storm:3], [storm]");
	});

	it("leaves a weakness of that name", () => {
		expect(removeFromTagString("[-rope], [rope]", "story", "rope")).toBe(
			"[-rope]",
		);
	});

	it("removes every copy, so a duplicate is not synced back", () => {
		expect(removeFromTagString("[fog], [lamp], [Fog]", "story", "fog")).toBe(
			"[lamp]",
		);
	});

	it("returns the string untouched when the tag is not in it", () => {
		const tags = "[fog], [storm:3]";
		expect(removeFromTagString(tags, "story", "rope")).toBe(tags);
		expect(removeFromTagString("", "story", "rope")).toBe("");
	});

	it("keeps prose around the markup", () => {
		expect(
			removeFromTagString("A cold night. [fog] and [rope].", "story", "fog"),
		).toBe("A cold night. and [rope].");
	});
});
