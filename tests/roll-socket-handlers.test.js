import { beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import { Sockets } from "../modules/system/sockets.js";

// The roll handlers in `Sockets.registerListeners` that sit between a packet
// and the dialog: an approved roll is executed once, a sync request is
// answered by the right seat, and an edit reaches the dialog with the sender
// the server attested. (Who may send the table-wide packets is in
// roll-dialog-lifecycle.test.js; `resolveApprovedRoll` itself in
// roll-moderation-authz.test.js.)

const USERS = {
	gm: { id: "gm", isGM: true },
	gm2: { id: "gm2", isGM: true },
	player: { id: "player", isGM: false },
	other: { id: "other", isGM: false },
};

let handlers;
let actors;
beforeEach(() => {
	vi.restoreAllMocks();
	handlers = new Map();
	actors = new Map();
	vi.spyOn(Sockets, "on").mockImplementation((name, handler) =>
		handlers.set(name, handler),
	);
	Sockets.registerListeners();
	game.userId = "player";
	game.user = USERS.player;
	game.users.get.mockImplementation((id) => USERS[id]);
	game.actors.get.mockImplementation((id) => actors.get(id) ?? null);
});

describe("an approved roll (rollDice)", () => {
	const STORED = { actorId: "hero", tags: [], type: "quick" };
	let roll;
	const card = (id, data = STORED) => ({
		id,
		author: { id: "player" },
		getFlag: (scope, key) =>
			scope === "litmv2" && key === "data" ? data : undefined,
	});
	const approve = (messageId, senderId = "gm") =>
		handlers.get("rollDice")({
			senderId,
			data: { userId: "player", messageId },
		});

	beforeEach(() => {
		const cards = new Map([
			["m1", card("m1")],
			["m2", card("m2", { ...STORED, type: "tracked" })],
		]);
		game.messages.get.mockImplementation((id) => cards.get(id));
		roll = vi.spyOn(LitmRollDialog, "roll").mockResolvedValue(undefined);
	});

	it("rolls what the roller's own card stored", () => {
		approve("m1");
		expect(roll).toHaveBeenCalledTimes(1);
		expect(roll).toHaveBeenCalledWith(STORED);
	});

	// Two Narrators approving the same card each send the packet.
	it("rolls once when two Narrators approve the same card", () => {
		approve("m1", "gm");
		approve("m1", "gm2");
		expect(roll).toHaveBeenCalledTimes(1);
	});

	it("rolls each card that is approved", () => {
		approve("m1");
		approve("m2");
		expect(roll.mock.calls.map(([data]) => data.type)).toEqual([
			"quick",
			"tracked",
		]);
	});

	it("does not let a refused packet use the card up", () => {
		approve("m1", "other");
		expect(roll).not.toHaveBeenCalled();
		approve("m1", "gm");
		expect(roll).toHaveBeenCalledTimes(1);
	});

	it("rolls nothing for an approval addressed to someone else", () => {
		handlers.get("rollDice")({
			senderId: "gm",
			data: { userId: "other", messageId: "m1" },
		});
		expect(roll).not.toHaveBeenCalled();
	});
});

describe("a request for the roll's draft (requestRollDialogSync)", () => {
	const dialogFor = (isOwner) => {
		const dialog = {
			isOwner,
			dispatchSync: vi.fn(),
			dispatchReseat: vi.fn(),
		};
		actors.set("hero", {
			id: "hero",
			sheet: { hasRollDialog: true, rollDialogInstance: dialog },
		});
		return dialog;
	};
	const request = (data) =>
		handlers.get("requestRollDialogSync")({ senderId: "other", data });

	it("is answered by the owner, who publishes the draft", () => {
		const dialog = dialogFor(true);
		request({ actorId: "hero" });
		expect(dialog.dispatchSync).toHaveBeenCalledTimes(1);
		expect(dialog.dispatchReseat).not.toHaveBeenCalled();
	});

	it("is answered by the owner the same way when a reseat was asked for", () => {
		const dialog = dialogFor(true);
		request({ actorId: "hero", reseat: true });
		expect(dialog.dispatchSync).toHaveBeenCalledTimes(1);
		expect(dialog.dispatchReseat).not.toHaveBeenCalled();
	});

	it("is answered by a viewer only when the reloaded owner asks for a reseat", () => {
		const dialog = dialogFor(false);
		request({ actorId: "hero" });
		expect(dialog.dispatchReseat).not.toHaveBeenCalled();
		request({ actorId: "hero", reseat: true });
		expect(dialog.dispatchReseat).toHaveBeenCalledTimes(1);
		expect(dialog.dispatchSync).not.toHaveBeenCalled();
	});

	// `rollDialogInstance` creates a dialog, which would enrol this client in
	// every roll socket for that actor.
	it("does not create a dialog on a client that has none open", () => {
		const sheet = {
			hasRollDialog: false,
			get rollDialogInstance() {
				throw new Error("created a dialog to answer a sync request");
			},
		};
		actors.set("hero", { id: "hero", sheet });
		expect(() => request({ actorId: "hero", reseat: true })).not.toThrow();
		expect(() => request({ actorId: "gone" })).not.toThrow();
	});
});

describe("a roll edit (updateRollDialog)", () => {
	it("reaches the actor's dialog with the sender the server attested", () => {
		const sheet = { updateRollDialog: vi.fn() };
		actors.set("hero", { id: "hero", sheet });
		handlers.get("updateRollDialog")({
			senderId: "other",
			// A sender written into the payload is not the sender.
			data: { actorId: "hero", might: 3, senderId: "gm" },
		});
		expect(sheet.updateRollDialog).toHaveBeenCalledWith({
			actorId: "hero",
			might: 3,
			senderId: "other",
		});
	});

	it("is dropped for an actor this client does not know", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(() =>
			handlers.get("updateRollDialog")({
				senderId: "other",
				data: { actorId: "gone" },
			}),
		).not.toThrow();
	});
});
