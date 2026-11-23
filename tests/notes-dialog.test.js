import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotesDialog } from "../modules/apps/notes-dialog.js";

const { DialogV2 } = foundry.applications.api;

// A rendered notes window: its editor, and the dialog's own Save button.
const open = async ({ dirty = false } = {}) => {
	const dialog = new NotesDialog();
	const listeners = {};
	const editor = {
		// As it reads the stored note; typing changes it.
		value: "<p>old</p>",
		classList: { contains: () => false },
		addEventListener: (type, fn) => {
			listeners[type] = fn;
		},
	};
	const ok = { click: vi.fn() };
	dialog.element = {
		querySelector: (sel) =>
			sel === "prose-mirror" ? editor : sel.includes("ok") ? ok : null,
	};
	dialog.rendered = true;
	await dialog._onFirstRender({}, {});
	listeners.open();
	if (dirty) editor.value = "<p>old and new</p>";
	const editorSave = () => {
		const event = { preventDefault: vi.fn() };
		listeners.save(event);
		return event;
	};
	return { dialog, ok, editorSave };
};

describe("NotesDialog", () => {
	beforeEach(() => {
		DialogV2.confirm = vi.fn();
	});

	it("closes at once when nothing was written", async () => {
		const { dialog } = await open();
		await dialog.close();
		expect(DialogV2.confirm).not.toHaveBeenCalled();
		expect(dialog.rendered).toBe(false);
	});

	it("asks before throwing away an edited note, and stays open on no", async () => {
		const { dialog } = await open({ dirty: true });
		DialogV2.confirm.mockResolvedValue(false);
		await dialog.close();
		expect(DialogV2.confirm).toHaveBeenCalledOnce();
		expect(dialog.rendered).toBe(true);
	});

	it("closes an edited note when the discard is confirmed", async () => {
		const { dialog } = await open({ dirty: true });
		DialogV2.confirm.mockResolvedValue(true);
		await dialog.close();
		expect(dialog.rendered).toBe(false);
	});

	it("asks once, however often Escape is pressed while it asks", async () => {
		const { dialog } = await open({ dirty: true });
		let answer;
		DialogV2.confirm.mockReturnValue(new Promise((r) => (answer = r)));
		const first = dialog.close();
		await dialog.close();
		answer(false);
		await first;
		expect(DialogV2.confirm).toHaveBeenCalledOnce();
	});

	it("does not ask when the note is being saved", async () => {
		const { dialog } = await open({ dirty: true });
		await dialog.close({ submitted: true });
		expect(DialogV2.confirm).not.toHaveBeenCalled();
		expect(dialog.rendered).toBe(false);
	});

	it("turns the editor's own save (its button, Ctrl+S) into Save Notes", async () => {
		const { ok, editorSave } = await open({ dirty: true });
		const event = editorSave();
		expect(event.preventDefault).toHaveBeenCalled();
		expect(ok.click).toHaveBeenCalledOnce();
	});

	it("ignores the save the editor fires as the window closes", async () => {
		const { dialog, ok, editorSave } = await open();
		await dialog.close();
		editorSave();
		expect(ok.click).not.toHaveBeenCalled();
	});
});
