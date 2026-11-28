import { describe, expect, it, vi } from "vitest";
import { ChallengeSheet } from "../modules/actor/challenge/challenge-sheet.js";

// The play-mode +/- on a limit nobody is giving statuses to. They are Advance
// and Set Back by one, so they go through `advanceLimit`: a direct write of
// `value` would be erased by the next status recalc, and would never announce
// a limit reached.
const click = (action, sheet, limitId = "lim-1") =>
	ChallengeSheet.DEFAULT_OPTIONS.actions[action].call(
		sheet,
		{},
		{ dataset: { limitId } },
	);

const makeSheet = (limits) => ({
	system: { limits, advanceLimit: vi.fn().mockResolvedValue({}) },
	document: { update: vi.fn() },
	_notifyStoryTags: vi.fn(),
});

describe("Challenge sheet limit +/- buttons", () => {
	const limit = { id: "lim-1", label: "Harvest", max: 4, value: 1 };

	it("increase advances the limit by one", async () => {
		const sheet = makeSheet([limit]);
		await click("increaseLimit", sheet);
		expect(sheet.system.advanceLimit).toHaveBeenCalledWith("lim-1", 1);
		expect(sheet.document.update).not.toHaveBeenCalled();
	});

	it("decrease sets the limit back by one", async () => {
		const sheet = makeSheet([limit]);
		await click("decreaseLimit", sheet);
		expect(sheet.system.advanceLimit).toHaveBeenCalledWith("lim-1", -1);
		expect(sheet.document.update).not.toHaveBeenCalled();
	});

	// The row names its limit by id, not by its place in the stored list: an
	// addon's limit (issue #240) is in no stored list of the Challenge's.
	it("advances the limit the row names, wherever it is stored", async () => {
		const sheet = makeSheet([limit]);
		await click("increaseLimit", sheet, "addon-limit");
		expect(sheet.system.advanceLimit).toHaveBeenCalledWith("addon-limit", 1);
	});
});
