import { beforeEach, describe, expect, it, vi } from "vitest";
import { LitmActorSheet } from "../modules/sheets/base-actor-sheet.js";

// The play board's "Add status" prompt reads its input the way the story-tag
// sidebar's quick-add does: "name-N" is a status named "name" at tier N.
describe("LitmActorSheet._onAddStoryTag status prompt", () => {
	const target = { dataset: { tagType: "status_tag", promptName: "" } };
	let sheet;

	beforeEach(() => {
		sheet = {
			document: { system: { addStatus: vi.fn() } },
			_notifyStoryTags: vi.fn(),
		};
	});

	const submit = (name) => {
		foundry.applications.api.DialogV2.input = vi
			.fn()
			.mockResolvedValue({ name });
		return LitmActorSheet._onAddStoryTag.call(sheet, null, target);
	};

	it("splits a trailing -N into the name and its tier", async () => {
		await submit("status-4");
		expect(sheet.document.system.addStatus).toHaveBeenCalledWith("status", {
			tier: 4,
		});
	});

	it("keeps a plain name at the default tier", async () => {
		await submit("hurt");
		expect(sheet.document.system.addStatus).toHaveBeenCalledWith("hurt", {});
	});

	it("keeps input that is not status markup as typed", async () => {
		await submit("charm!");
		expect(sheet.document.system.addStatus).toHaveBeenCalledWith("charm!", {});
	});

	it("does nothing for an empty name", async () => {
		await submit("   ");
		expect(sheet.document.system.addStatus).not.toHaveBeenCalled();
	});
});
