import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../modules/utils.js", async (importOriginal) => ({
	...(await importOriginal()),
	enrichPlainText: vi.fn(async (text, _doc, options) => ({ text, options })),
}));

import { TagStringSyncMixin } from "../modules/sheets/tag-string-sync-mixin.js";

// The Journey and Challenge play sheets share one path from tag string to
// chips. A player must not get a hidden status or an unrevealed limit by name.
describe("TagStringSyncMixin#_enrichTagString", () => {
	afterEach(() => {
		game.user.isGM = false;
	});

	const effect = (name, type, isHidden) => ({ name, type, system: { isHidden } });
	const journey = {
		allApplicableEffects: () => [
			effect("fog", "story_tag", false),
			effect("lost", "status_tag", true),
		],
	};
	const limits = [
		{ label: "storm", hidden: false },
		{ label: "ambush", hidden: true },
	];
	const playTags = "[fog] [lost-2] [storm:3] [ambush:2]";

	const sheet = (isEditMode) => {
		const Sheet = TagStringSyncMixin(class {});
		const instance = new Sheet();
		instance.document = journey;
		instance._isEditMode = isEditMode;
		return instance;
	};

	it("drops a hidden status and an unrevealed limit for a player in play mode", async () => {
		const { text, options } = await sheet(false)._enrichTagString({
			playTags,
			limits,
		});
		expect(text).toBe("[fog] [storm:3]");
		expect(options).toBeUndefined();
	});

	it("keeps everything for the Narrator and marks what players can't see", async () => {
		game.user.isGM = true;
		const { text, options } = await sheet(false)._enrichTagString({
			playTags,
			limits,
		});
		expect(text).toBe(playTags);
		expect([...options.hiddenTagKeys]).toEqual(
			expect.arrayContaining(["limit:ambush"]),
		);
		expect(options.hiddenTagKeys.size).toBe(2);
	});

	it("renders the raw edit string in edit mode", async () => {
		const { text, options } = await sheet(true)._enrichTagString({
			playTags: "[derived]",
			editTags: playTags,
			limits,
		});
		expect(text).toBe(playTags);
		expect(options).toBeUndefined();
	});
});
