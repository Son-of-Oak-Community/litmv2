import { afterEach, describe, expect, it } from "vitest";
import {
	hiddenTagKeys,
	playerVisibleTagString,
} from "../modules/item/action/tag-string.js";
import { tagChipHtml } from "../modules/system/renderers/renderer-utils.js";

// A Challenge's tag string is a second copy of its effects; for a player it
// must not name what the Narrator hid.
describe("playerVisibleTagString", () => {
	afterEach(() => {
		game.user.isGM = false;
	});

	const effect = (name, type, isHidden) => ({ name, type, system: { isHidden } });
	const actor = (...effects) => ({ allApplicableEffects: () => effects });

	const challenge = actor(
		effect("coiled", "story_tag", false),
		effect("venomous", "story_tag", true),
		effect("enraged", "status_tag", true),
		effect("wounded", "status_tag", false),
	);
	const text = "[coiled] [venomous] [enraged-3] [wounded-2] [-slow] [harm:4] [flee:3]";
	const limits = [
		{ label: "harm", hidden: false },
		{ label: "flee", hidden: true },
	];

	it("drops hidden tags, statuses and limits for a player", () => {
		expect(playerVisibleTagString(text, challenge, { limits })).toBe(
			"[coiled] [wounded-2] [-slow] [harm:4]",
		);
	});

	it("leaves no stray separators in a comma-separated string", () => {
		expect(
			playerVisibleTagString("[coiled], [venomous], [wounded-2], [enraged-3]", challenge),
		).toBe("[coiled], [wounded-2]");
	});

	it("treats a limit with no hidden flag as hidden", () => {
		expect(
			playerVisibleTagString("[harm:4]", actor(), { limits: [{ label: "harm" }] }),
		).toBe("");
	});

	it("keeps a name a visible effect also carries", () => {
		const both = actor(
			effect("venomous", "story_tag", true),
			effect("venomous", "story_tag", false),
		);
		expect(playerVisibleTagString("[venomous]", both)).toBe("[venomous]");
	});

	it("leaves the string untouched for the Narrator", () => {
		game.user.isGM = true;
		expect(playerVisibleTagString(text, challenge, { limits })).toBe(text);
	});
});

// The Narrator's Challenge sheet keeps every chip and marks these keys hidden.
describe("hiddenTagKeys", () => {
	const effect = (name, type, isHidden) => ({ name, type, system: { isHidden } });
	const actor = (...effects) => ({ allApplicableEffects: () => effects });

	it("keys hidden tags, statuses and unrevealed limits, not a name also shown", () => {
		const challenge = actor(
			effect("Venomous", "story_tag", true),
			effect("enraged", "status_tag", true),
			effect("coiled", "story_tag", true),
			effect("coiled", "story_tag", false),
		);
		const limits = [
			{ label: "harm", hidden: false },
			{ label: "Flee", hidden: true },
		];

		expect([...hiddenTagKeys(challenge, { limits })].sort()).toEqual([
			"limit:flee",
			"status:enraged",
			"story:venomous",
		]);
	});
});

describe("tagChipHtml hidden", () => {
	it("dims the chip and puts the eye-slash beside it, outside the dim", () => {
		const html = tagChipHtml({ kind: "story", name: "venomous" }, { hidden: true });

		expect(html).toMatch(/^<span class="litm--hidden-wrap"><span class="litm--tag-hidden litm-tag"/);
		// The mark follows the chip's closing tag, so the dim can't reach it.
		expect(html).toMatch(/venomous<\/span><i class="[^"]*litm--hidden-mark/);
		expect(html.endsWith("</i></span>")).toBe(true);
	});

	it("leaves a visible chip alone", () => {
		expect(tagChipHtml({ kind: "story", name: "coiled" })).not.toContain("litm--hidden");
	});
});
