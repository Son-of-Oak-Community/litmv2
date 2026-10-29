import { describe, expect, it, vi } from "vitest";
import { TropeSheet } from "../modules/item/trope/trope-sheet.js";

// The Backpack Choices legend's + button fires `addEntry`; the sheet once
// registered only `removeEntry`, so the button did nothing.
const click = (sheet, path) =>
	TropeSheet.DEFAULT_OPTIONS.actions.addEntry.call(sheet, {}, { dataset: { path } });

const makeSheet = (backpackChoices) => {
	const document = { system: { backpackChoices }, update: vi.fn() };
	return { document };
};

describe("Trope sheet addEntry", () => {
	it("appends an empty backpack choice", async () => {
		const sheet = makeSheet(["rope", "lantern"]);
		await click(sheet, "system.backpackChoices");
		expect(sheet.document.update).toHaveBeenCalledWith({
			"system.backpackChoices": ["rope", "lantern", ""],
		});
	});

	it("ignores a button with no path", async () => {
		const sheet = makeSheet([]);
		await click(sheet, undefined);
		expect(sheet.document.update).not.toHaveBeenCalled();
	});
});
