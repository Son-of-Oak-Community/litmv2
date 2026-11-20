import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeroSheet } from "../modules/actor/hero/hero-sheet.js";

describe("HeroSheet editNotes", () => {
	const editNotes = HeroSheet.DEFAULT_OPTIONS.actions.editNotes;
	const makeSheet = () => ({
		isEditable: true,
		document: {
			id: "h1",
			uuid: "Actor.h1",
			name: "Hero",
			system: { notes: "old <b>" },
			update: vi.fn(),
		},
	});

	beforeEach(() => {
		foundry.applications.instances = new Map();
		foundry.applications.api.DialogV2.input = vi.fn();
	});

	it("saves system.notes on confirm and uses a stable id", async () => {
		const sheet = makeSheet();
		foundry.applications.api.DialogV2.input.mockResolvedValue({ notes: "new" });
		await editNotes.call(sheet);
		const opts = foundry.applications.api.DialogV2.input.mock.calls[0][0];
		expect(opts.id).toBe("litm-notes-h1");
		expect(opts.content).toContain("old &lt;b&gt;");
		expect(sheet.document.update).toHaveBeenCalledWith({
			"system.notes": "new",
		});
	});

	it.each([null, undefined])("skips the update on cancel (%s)", async (r) => {
		const sheet = makeSheet();
		foundry.applications.api.DialogV2.input.mockResolvedValue(r);
		await editNotes.call(sheet);
		expect(sheet.document.update).not.toHaveBeenCalled();
	});

	it("does nothing when the sheet cannot save (e.g. a locked compendium)", async () => {
		const sheet = { ...makeSheet(), isEditable: false };
		await editNotes.call(sheet);
		expect(foundry.applications.api.DialogV2.input).not.toHaveBeenCalled();
		expect(sheet.document.update).not.toHaveBeenCalled();
	});

	it("reuses an already-open dialog instead of opening another", async () => {
		const sheet = makeSheet();
		const open = { bringToFront: vi.fn() };
		foundry.applications.instances.set("litm-notes-h1", open);
		await editNotes.call(sheet);
		expect(open.bringToFront).toHaveBeenCalled();
		expect(foundry.applications.api.DialogV2.input).not.toHaveBeenCalled();
		expect(sheet.document.update).not.toHaveBeenCalled();
	});
});
