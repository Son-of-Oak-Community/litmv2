import { beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import { Sockets } from "../modules/system/sockets.js";

let actor;

function makeDialog(options = {}) {
	const dialog = new LitmRollDialog({
		actorId: actor.id,
		ownerId: "player",
		...options,
	});
	dialog.tabGroups = {};
	dialog.render = vi.fn();
	return dialog;
}

beforeEach(() => {
	vi.restoreAllMocks();
	game.user = { id: "player", isGM: false };
	game.users = {
		get: (id) => ({ id, active: true, isGM: id === "gm" }),
	};
	game.litmv2 = {};
	actor = {
		id: "hero",
		name: "Hero",
		sheet: {},
		getFlag: vi.fn(() => ({ ownerId: "player", narrator: true })),
		setFlag: vi.fn(),
		unsetFlag: vi.fn(),
	};
	game.actors.get.mockReturnValue(actor);
	foundry.applications.api.ApplicationV2.prototype.close = async function () {
		this.rendered = false;
	};
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
});

describe("called-roll lifecycle", () => {
	it("releases cancelled call authority while preserving the draft for reopening", async () => {
		const dialog = makeDialog();
		dialog.configureSharedRoll({
			ownerId: "player",
			narratorUserId: "gm",
			title: "Cross the bridge",
		});
		dialog.setSelection("tag", "negative", "gm", { narrator: true });
		dialog.rendered = true;
		const syncSession = dialog.syncSession;
		await dialog.close();

		expect(dialog.narratorCall).toBeNull();
		expect(dialog.getSelection("tag")).toMatchObject({
			state: "negative",
			narrator: false,
		});
		expect(dialog.rollName).toBe("Cross the bridge");
		expect(actor.unsetFlag).toHaveBeenCalledOnce();
		expect(Sockets.dispatch).toHaveBeenCalledWith("closeRollDialog", {
			actorId: actor.id,
			syncSession,
			preserveAuthority: false,
		});
		dialog.setType("sacrifice");
		expect(dialog.type).toBe("sacrifice");
	});

	it("a Narrator closing their view neither ends nor unadvertises the player's call", async () => {
		game.user = { id: "gm", isGM: true };
		const dialog = makeDialog();
		dialog.configureSharedRoll({ ownerId: "player", narratorUserId: "gm" });
		dialog.rendered = true;
		await dialog.close();

		expect(dialog.narratorCall?.narratorUserId).toBe("gm");
		expect(actor.unsetFlag).not.toHaveBeenCalled();
		expect(Sockets.dispatch).not.toHaveBeenCalledWith(
			"closeRollDialog",
			expect.anything(),
		);
	});

	it("suspends narrator authority for approval and restores the same locked draft on rejection", async () => {
		const dialog = makeDialog();
		dialog.configureSharedRoll({ ownerId: "player", narratorUserId: "gm" });
		dialog.setSelection("tag", "negative", "gm", { narrator: true });
		game.settings.get.mockReturnValue(true);
		vi.spyOn(dialog, "_createModerationRequest").mockResolvedValue(undefined);
		await LitmRollDialog._onSubmit.call(dialog, null, null, {});
		dialog.rendered = true;
		await dialog.close(); // Foundry's closeOnSubmit.

		expect(dialog.narratorCall?.narratorUserId).toBe("gm");
		expect(dialog.getSelection("tag").narrator).toBe(true);
		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"closeRollDialog",
			expect.objectContaining({ preserveAuthority: true }),
		);
		dialog.activateSync(); // Rejection reopens this retained draft.
		expect(dialog.canSetNarratorFields).toBe(false);
		dialog.setCharacterTagState("tag", "");
		expect(dialog.getSelection("tag").state).toBe("negative");
	});

	it("releases local authority before waiting for flag persistence", async () => {
		const dialog = makeDialog();
		dialog.configureSharedRoll({ ownerId: "player", narratorUserId: "gm" });
		let finish;
		actor.unsetFlag.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				}),
		);
		const closing = dialog.close();
		expect(dialog.canSetNarratorFields).toBe(true);
		await Promise.resolve();
		finish();
		await closing;
	});

	it("releases authority and tells peers even when flag persistence fails", async () => {
		const dialog = makeDialog();
		dialog.configureSharedRoll({ ownerId: "player", narratorUserId: "gm" });
		dialog.rendered = true;
		actor.unsetFlag.mockRejectedValue(new Error("offline"));
		await expect(dialog.close()).rejects.toThrow("offline");
		expect(dialog.canSetNarratorFields).toBe(true);
		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"closeRollDialog",
			expect.objectContaining({ preserveAuthority: false }),
		);
	});

	it("ends an already-hidden viewer when the owner's close socket arrives", () => {
		game.user = { id: "gm", isGM: true };
		const dialog = makeDialog();
		dialog.configureSharedRoll({ ownerId: "player", narratorUserId: "gm" });
		dialog.setSelection("tag", "negative", "gm", { narrator: true });
		actor.sheet = { hasRollDialog: true, rollDialogInstance: dialog };
		const handlers = new Map();
		vi.spyOn(Sockets, "on").mockImplementation((name, handler) =>
			handlers.set(name, handler),
		);
		Sockets.registerListeners();
		handlers.get("closeRollDialog")({ data: { actorId: actor.id } });
		expect(dialog.narratorCall).toBeNull();
		expect(dialog.getSelection("tag").narrator).toBe(false);
	});

	it("keeps the explicit reaction entry point available on a called player roll", () => {
		const dialog = makeDialog();
		dialog.configureSharedRoll({ ownerId: "player", narratorUserId: "gm" });
		dialog.setType("mitigate");
		expect(dialog.type).toBe("mitigate");
		expect(dialog.extractRollData().type).toBe("mitigate");
	});

	it("stamps Narrator selections from the sheet and refuses the player's edit", () => {
		game.user = { id: "gm", isGM: true };
		const dialog = makeDialog();
		dialog.configureSharedRoll({ ownerId: "player", narratorUserId: "gm" });
		dialog.setCharacterTagState("tag", "negative");
		expect(dialog.getSelection("tag").narrator).toBe(true);

		game.user = { id: "player", isGM: false };
		dialog.setCharacterTagState("tag", "");
		expect(dialog.getSelection("tag").state).toBe("negative");
	});
});

describe("local-only roll previews", () => {
	it("uses a separate application identity from the actor's shared dialog", () => {
		const liveOptions = { actorId: "hero" };
		const previewOptions = { actorId: "hero", localOnly: true };
		new LitmRollDialog(liveOptions);
		new LitmRollDialog(previewOptions);
		expect(liveOptions.id).toBe("litm-roll-dialog-hero");
		expect(previewOptions.id).toMatch(/^litm-roll-preview-/);
	});

	it("does not publish presence, broadcast changes or submit the demo roll", async () => {
		game.user = { id: "gm", isGM: true };
		const dialog = makeDialog({ ownerId: "gm", localOnly: true });
		dialog.configureSharedRoll({ ownerId: "gm", narratorUserId: "gm" });
		const extract = vi.spyOn(dialog, "extractRollData");
		await dialog.updatePresence(true);
		dialog.dispatchSync();
		await LitmRollDialog._onSubmit.call(dialog, null, null, {});
		dialog.rendered = true;
		await dialog.close();

		expect(extract).not.toHaveBeenCalled();
		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(actor.unsetFlag).not.toHaveBeenCalled();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});
});
