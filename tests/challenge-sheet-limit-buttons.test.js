import { describe, expect, it, vi } from "vitest";
import { ChallengeSheet } from "../modules/actor/challenge/challenge-sheet.js";

// The play-mode +/- on a limit nobody is giving statuses to. They are Advance
// and Set Back by one, so they go through `advanceLimit`: a direct write of
// `value` would be erased by the next status recalc, and would never announce
// a limit reached.
const click = (action, sheet, index = 0) =>
	ChallengeSheet.DEFAULT_OPTIONS.actions[action].call(
		sheet,
		{},
		{ dataset: { index: String(index) } },
	);

const makeSheet = (limits) => ({
	system: { limits, advanceLimit: vi.fn().mockResolvedValue({}) },
	document: { update: vi.fn() },
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

	it("leaves an immunity (max 0) alone", async () => {
		const sheet = makeSheet([{ ...limit, max: 0 }]);
		await click("increaseLimit", sheet);
		await click("decreaseLimit", sheet);
		expect(sheet.system.advanceLimit).not.toHaveBeenCalled();
	});

	it("ignores an index with no limit", async () => {
		const sheet = makeSheet([limit]);
		await click("increaseLimit", sheet, 3);
		expect(sheet.system.advanceLimit).not.toHaveBeenCalled();
	});
});
