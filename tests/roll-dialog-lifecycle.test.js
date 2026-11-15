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
		items: [{ id: "theme", type: "theme", system: {}, effects: [] }],
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
			cancelled: false,
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

	// The window's X: on a called roll it is the Narrator's Cancel; on a roll
	// the player started it only closes the Narrator's view.
	describe("the Narrator's X", () => {
		const clickX = (dialog) => {
			foundry.applications.api.ApplicationV2.prototype._onFirstRender =
				() => {};
			let onClose;
			dialog.window = {
				close: { addEventListener: (_type, cb) => (onClose = cb) },
			};
			dialog.element = { addEventListener: () => {} };
			dialog._onFirstRender({}, {});
			onClose({ button: 0 });
		};

		it("cancels a roll the Narrator called", () => {
			game.user = { id: "gm", isGM: true };
			const dialog = makeDialog();
			dialog.configureSharedRoll({ ownerId: "player", narratorUserId: "gm" });
			clickX(dialog);
			expect(Sockets.dispatch).toHaveBeenCalledWith(
				"narratorRollCommand",
				expect.objectContaining({ command: "cancel" }),
			);
		});

		it("leaves a roll the player started alone", () => {
			game.user = { id: "gm", isGM: true };
			const dialog = makeDialog();
			dialog.configureSharedRoll({ ownerId: "player" });
			clickX(dialog);
			expect(Sockets.dispatch).not.toHaveBeenCalledWith(
				"narratorRollCommand",
				expect.anything(),
			);
			expect(actor.unsetFlag).not.toHaveBeenCalled();
		});
	});

	it("suspends narrator authority for approval and restores the same locked draft on rejection", async () => {
		const dialog = makeDialog();
		dialog.configureSharedRoll({ ownerId: "player", narratorUserId: "gm" });
		dialog.setSelection("tag", "negative", "gm", { narrator: true });
		game.settings.get.mockReturnValue(true);
		vi.spyOn(dialog, "_createModerationRequest").mockResolvedValue(undefined);
		dialog.rendered = true;
		// _onSubmit closes the window itself once the request is posted.
		await LitmRollDialog._onSubmit.call(dialog, null, null, {});

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

describe("the Narrator's Roll and Cancel on the roller's client", () => {
	let handlers;
	const command = (data, senderId = "gm") =>
		handlers.get("narratorRollCommand")({
			senderId,
			data: { actorId: actor.id, ...data },
		});

	beforeEach(() => {
		handlers = new Map();
		vi.spyOn(Sockets, "on").mockImplementation((name, handler) =>
			handlers.set(name, handler),
		);
		Sockets.registerListeners();
	});

	function openDialog() {
		const dialog = makeDialog();
		dialog.rendered = true;
		dialog.submit = vi.fn(async () => {});
		dialog.close = vi.fn();
		dialog.painfulSacrificeHasNoTarget = () => false;
		dialog.sacrificeThemeMissing = () => false;
		actor.sheet = { hasRollDialog: true, rollDialogInstance: dialog };
		return dialog;
	}

	it("ignores a command from a player", async () => {
		const dialog = openDialog();
		await command({ command: "roll" }, "player2");
		expect(dialog.submit).not.toHaveBeenCalled();
	});

	it("rolls past approval, and cancels by closing", async () => {
		const dialog = openDialog();
		await command({ command: "roll" });
		expect(dialog.submit).toHaveBeenCalledWith({
			narrator: true,
			checked: true,
		});
		await command({ command: "cancel" });
		expect(dialog.close).toHaveBeenCalled();
	});

	it("tells the Narrator when a Sacrifice has nothing left to pay", async () => {
		const dialog = openDialog();
		dialog.painfulSacrificeHasNoTarget = () => true;
		await command({ command: "roll" });
		expect(dialog.submit).not.toHaveBeenCalled();
		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"narratorRollCommandRefused",
			{
				userId: "gm",
				reason: "sacrifice",
			},
		);
	});

	// After a reload the called roll lives on in the flag, with no window.
	it("cancels a called roll the roller hasn't reopened, and refuses to roll it", async () => {
		await command({ command: "roll" });
		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"narratorRollCommandRefused",
			{
				userId: "gm",
				reason: "closed",
			},
		);
		expect(actor.unsetFlag).not.toHaveBeenCalled();
		await command({ command: "cancel" });
		expect(actor.unsetFlag).toHaveBeenCalledWith("litmv2", "rollDialogOwner");
		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"closeRollDialog",
			expect.objectContaining({ actorId: actor.id, cancelled: true }),
		);
	});
});

describe("the Narrator cancelling a roll whose owner is away", () => {
	it("ends the call on the Narrator's side too", async () => {
		game.user = { id: "gm", isGM: true };
		game.users = {
			get: (id) => ({ id, active: id !== "player", isGM: id === "gm" }),
		};
		const dialog = makeDialog();
		dialog.configureSharedRoll({ ownerId: "player", narratorUserId: "gm" });
		dialog.setSelection("tag", "negative", "gm", { narrator: true });
		dialog.rendered = true;
		await LitmRollDialog.DEFAULT_OPTIONS.actions.narratorCommand.call(
			dialog,
			null,
			{
				dataset: { command: "cancel" },
			},
		);
		expect(dialog.narratorCall).toBeNull();
		expect(dialog.getSelection("tag").narrator).toBe(false);
	});
});

describe("Sacrifice theme choice", () => {
	// Nothing picks the theme a Sacrifice risks: a stray Roll must not stake
	// a theme the player never chose.
	it("refuses a Sacrifice until a theme is chosen", () => {
		expect(makeDialog({ type: "sacrifice" }).sacrificeThemeMissing()).toBe(true);
		expect(
			makeDialog({
				type: "sacrifice",
				sacrificeThemeId: "theme",
			}).sacrificeThemeMissing(),
		).toBe(false);
		expect(makeDialog({ type: "quick" }).sacrificeThemeMissing()).toBe(false);
	});

	it("counts a chosen theme deleted since as none chosen", () => {
		expect(
			makeDialog({ type: "sacrifice", sacrificeThemeId: "gone" }).sacrificeThemeMissing(),
		).toBe(true);
	});

	it("keeps the Narrator's refused Roll off the player's screen", () => {
		const warn = vi.spyOn(ui.notifications, "warn");
		expect(makeDialog({ type: "sacrifice" }).rollRefusal({ narrator: true })).toBe(
			"sacrificeTheme",
		);
		expect(warn).not.toHaveBeenCalled();
	});

	// Core Book p.163/p.192: a story theme can pay a Painful price, but has no
	// Quest or Promise to be replaced by, so Scarring and Grave refuse it.
	it("takes a story theme for Painful only", () => {
		actor.items = [{ id: "lantern", type: "story_theme", system: {}, effects: [] }];
		const at = (sacrificeLevel) =>
			makeDialog({
				type: "sacrifice",
				sacrificeLevel,
				sacrificeThemeId: "lantern",
			}).extractRollData({}).sacrificeThemeId;
		expect(
			makeDialog({ type: "sacrifice", sacrificeLevel: "painful", sacrificeThemeId: "lantern" })
				.sacrificeThemeMissing(),
		).toBe(false);
		expect(at("painful")).toBe("lantern");
		// Nothing left to name above Painful: the Hero rolls without a theme,
		// and the story theme is not staked.
		for (const level of ["scarring", "grave"]) {
			const dialog = makeDialog({ type: "sacrifice", sacrificeLevel: level, sacrificeThemeId: "lantern" });
			expect(dialog.sacrificeThemeMissing()).toBe(false);
			expect(at(level)).toBeNull();
		}
	});

	it("still asks for a Hero theme on Scarring when a story theme is all that was picked", () => {
		actor.items.push({ id: "lantern", type: "story_theme", system: {}, effects: [] });
		const dialog = makeDialog({
			type: "sacrifice",
			sacrificeLevel: "scarring",
			sacrificeThemeId: "lantern",
		});
		expect(dialog.sacrificeThemeMissing({ quiet: true })).toBe(true);
	});

	it("lets a Hero with no theme left roll one", () => {
		actor.items = [];
		expect(makeDialog({ type: "sacrifice" }).sacrificeThemeMissing()).toBe(false);
	});
});

// p.159: a Sacrifice is a Quick outcome the player elects, so on a called roll
// the roller may switch Quick to Sacrifice and back, but no further.
describe("the roller's Sacrifice switch", () => {
	const calledRoll = () => {
		const dialog = makeDialog();
		dialog.configureSharedRoll({ ownerId: "player", narratorUserId: "gm" });
		dialog.updatePresence = vi.fn(async () => {});
		return dialog;
	};

	it("turns the Narrator's called Quick outcome into a Sacrifice and back", () => {
		const dialog = calledRoll();
		dialog.setType("sacrifice");
		expect(dialog.type).toBe("sacrifice");
		dialog.setType("quick");
		expect(dialog.type).toBe("quick");
	});

	it("leaves the rest of the move to the Narrator", () => {
		const dialog = calledRoll();
		dialog.setType("tracked");
		expect(dialog.type).toBe("quick");
	});

	it("starts every Sacrifice's grace at 0, whatever the Hero holds", () => {
		const dialog = calledRoll();
		actor.getFlag = vi.fn((_scope, key) =>
			key === "secretGrace"
				? [{ id: "m", text: "Spared the wolf", spent: false }]
				: { ownerId: "player", narrator: true },
		);
		dialog.setType("sacrifice");
		expect(dialog.extractRollData({}).sacrificeBonus).toBe(0);
	});

	it("keeps a granted grace at the Hero's tier as it changes, whole or none", async () => {
		const moments = [
			{ id: "a", text: "Spared the wolf" },
			{ id: "b", text: "Fed the stranger" },
		];
		actor.getFlag = vi.fn((_scope, key) =>
			key === "secretGrace" ? moments : { ownerId: "player", narrator: true },
		);
		const dialog = calledRoll();
		dialog.setType("sacrifice");
		dialog.followSecretGrace();
		expect(dialog.extractRollData({}).sacrificeBonus).toBe(0);
		await dialog.receiveUpdate({ actorId: actor.id, sacrificeBonus: 2 });
		// Only the Narrator's window holds the Hero's record.
		game.user = { id: "gm", isGM: true };
		moments[0].scratched = true;
		dialog.followSecretGrace();
		expect(dialog.extractRollData({}).sacrificeBonus).toBe(1);
		moments[1].scratched = true;
		dialog.followSecretGrace();
		expect(dialog.extractRollData({}).sacrificeBonus).toBe(0);
	});

	it("drops the Narrator's grace when the roll ends unrolled", async () => {
		const dialog = calledRoll();
		dialog.setType("sacrifice");
		await dialog.receiveUpdate({ actorId: actor.id, sacrificeBonus: 4 });
		expect(dialog.extractRollData({}).sacrificeBonus).toBe(4);
		dialog.endSharedRoll();
		expect(dialog.extractRollData({}).sacrificeBonus).toBe(0);
	});

	it("rolls no tags and no Action as a Sacrifice, and keeps the called Action", () => {
		const dialog = makeDialog();
		dialog.configureSharedRoll({
			ownerId: "player",
			narratorUserId: "gm",
			actionUuid: "Item.sneak",
		});
		dialog.updatePresence = vi.fn(async () => {});
		dialog.setSelection("tag-1", "scratched", "player");
		dialog.setType("sacrifice");
		expect(dialog.extractRollData({})).toMatchObject({ tags: [], actionUuid: null });
		dialog.setType("quick");
		expect(dialog.extractRollData({}).actionUuid).toBe("Item.sneak");
	});

	it("is Sacrifice or the called move, on a called roll of any move", () => {
		const dialog = makeDialog({ type: "tracked" });
		dialog.configureSharedRoll({ ownerId: "player", narratorUserId: "gm", type: "tracked" });
		dialog.updatePresence = vi.fn(async () => {});
		dialog.setType("tracked");
		expect(dialog.type).toBe("tracked");
		dialog.setType("sacrifice");
		expect(dialog.type).toBe("sacrifice");
		dialog.setType("quick");
		expect(dialog.type).toBe("sacrifice");
		dialog.setType("tracked");
		expect(dialog.type).toBe("tracked");
	});

	it("is a move of its own on the roller's own roll, from any move", () => {
		const dialog = makeDialog({ type: "tracked" });
		dialog.updatePresence = vi.fn(async () => {});
		dialog.setType("sacrifice");
		expect(dialog.type).toBe("sacrifice");
	});

	it("is never the Narrator's to pick for the player", () => {
		game.user = { id: "gm", isGM: true };
		const dialog = makeDialog();
		dialog.updatePresence = vi.fn(async () => {});
		expect(dialog.canProposeSacrifice).toBe(false);
		dialog.setType("sacrifice");
		expect(dialog.type).toBe("quick");
	});

	it("is not the switch of a Narrator watching the roll", () => {
		game.user = { id: "gm", isGM: true };
		expect(calledRoll().canProposeSacrifice).toBe(false);
	});

	it("rolls the Narrator's number with a Sacrifice", async () => {
		const { resolveRollFormula } = await import(
			"../modules/apps/roll/roll-pipeline.js"
		);
		expect(resolveRollFormula({ type: "sacrifice" })).toBe(
			"2d6 + @sacrificeBonus",
		);
	});
});
