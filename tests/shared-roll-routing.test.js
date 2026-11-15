import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallForRollApp } from "../modules/apps/roll/call-for-roll.js";
import {
	applySharedRoll,
	sendRollRequest,
	shouldJoinSharedRoll,
} from "../modules/apps/roll/roll-request.js";
import { Sockets } from "../modules/system/sockets.js";

// Who is *in* a Narrator's call, how the call seeds a dialog, and where an
// Action's "ask for a roll" button goes (modules/apps/roll/roll-request.js).

const hero = (id, { ownedBy = [] } = {}) => ({
	id,
	type: "hero",
	name: id,
	testUserPermission: vi.fn(
		(user, level) => level === "OWNER" && ownedBy.includes(user.id),
	),
});

let actors;
beforeEach(() => {
	actors = new Map();
	game.user = { id: "player", name: "Player", isGM: false };
	game.actors.get.mockImplementation((id) => actors.get(id) ?? null);
	game.actors.some = (fn) => [...actors.values()].some(fn);
	vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
	vi.restoreAllMocks();
	game.actors.get.mockReset();
});

describe("shouldJoinSharedRoll", () => {
	// Roll-request.js: "The roller is [in the roll], and so is any player who
	// owns a participating Hero in an Acting Together roll... Everyone else
	// learns about it from the HUD strip and joins if they want to."
	it("includes the user the call names as the roller", () => {
		expect(shouldJoinSharedRoll({ ownerId: "player" })).toBe(true);
	});

	it("leaves out a user who is neither the roller nor a participant's owner", () => {
		actors.set("hero-a", hero("hero-a", { ownedBy: ["someone-else"] }));
		expect(
			shouldJoinSharedRoll({ ownerId: "gm", participantIds: ["hero-a"] }),
		).toBe(false);
	});

	it("leaves out everyone on a call with no participants and another roller", () => {
		expect(shouldJoinSharedRoll({ ownerId: "gm" })).toBe(false);
		expect(shouldJoinSharedRoll({ ownerId: "gm", participantIds: [] })).toBe(
			false,
		);
	});

	it("includes a player who owns any one participating Hero", () => {
		actors.set("hero-a", hero("hero-a", { ownedBy: ["someone-else"] }));
		actors.set("hero-b", hero("hero-b", { ownedBy: ["player"] }));
		expect(
			shouldJoinSharedRoll({
				ownerId: "gm",
				participantIds: ["hero-a", "hero-b"],
			}),
		).toBe(true);
	});

	it("asks for OWNER permission, so watching a participant is not joining", () => {
		const watched = hero("hero-a", { ownedBy: [] });
		actors.set("hero-a", watched);
		shouldJoinSharedRoll({ ownerId: "gm", participantIds: ["hero-a"] });
		expect(watched.testUserPermission).toHaveBeenCalledWith(game.user, "OWNER");
	});

	it("ignores a participant the client does not know", () => {
		expect(
			shouldJoinSharedRoll({ ownerId: "gm", participantIds: ["gone"] }),
		).toBe(false);
	});

	it("leaves out a client when the call carries no roller and no participants", () => {
		expect(shouldJoinSharedRoll()).toBe(false);
		expect(shouldJoinSharedRoll({})).toBe(false);
	});
});

describe("applySharedRoll", () => {
	let dialog;
	let actor;
	beforeEach(() => {
		dialog = {
			isOwner: false,
			configureSharedRoll: vi.fn(),
			render: vi.fn(),
			dispatchSync: vi.fn(),
		};
		actor = { id: "hero", sheet: { rollDialogInstance: dialog } };
		actors.set("hero", actor);
	});
	const call = {
		actorId: "hero",
		ownerId: "player",
		title: "Strike",
		narratorUserId: "gm",
		syncSession: "call-1",
	};

	it("seeds the dialog with the whole call, then opens it", () => {
		applySharedRoll(call);
		expect(dialog.configureSharedRoll).toHaveBeenCalledWith(call);
		expect(dialog.render).toHaveBeenCalledWith(true);
		// Opening before seeding would render the previous roll's state.
		expect(dialog.configureSharedRoll.mock.invocationCallOrder[0]).toBeLessThan(
			dialog.render.mock.invocationCallOrder[0],
		);
	});

	it("has the roller's client publish the shared object", () => {
		dialog.isOwner = true;
		applySharedRoll(call);
		expect(dialog.dispatchSync).toHaveBeenCalledTimes(1);
		// ... after it is configured, so peers see the call and not a blank roll.
		expect(dialog.configureSharedRoll.mock.invocationCallOrder[0]).toBeLessThan(
			dialog.dispatchSync.mock.invocationCallOrder[0],
		);
	});

	it("leaves publishing to the roller on every other client", () => {
		dialog.isOwner = false;
		applySharedRoll(call);
		expect(dialog.dispatchSync).not.toHaveBeenCalled();
	});

	it("warns and opens nothing when the target actor is unknown", () => {
		applySharedRoll({ ...call, actorId: "gone" });
		expect(console.warn).toHaveBeenCalledTimes(1);
		expect(dialog.configureSharedRoll).not.toHaveBeenCalled();
		expect(dialog.render).not.toHaveBeenCalled();
	});

	it("warns and opens nothing when the actor has no roll dialog", () => {
		actor.sheet = { rollDialogInstance: null };
		applySharedRoll(call);
		expect(console.warn).toHaveBeenCalledTimes(1);
		expect(dialog.configureSharedRoll).not.toHaveBeenCalled();

		actor.sheet = null;
		expect(() => applySharedRoll(call)).not.toThrow();
		expect(console.warn).toHaveBeenCalledTimes(2);
	});
});

describe("sendRollRequest", () => {
	// Roll-request.js: "An Action embedded on a Hero already knows who is
	// rolling it, so it calls the roll for that Hero instead of opening a
	// picker with nobody chosen... A world or compendium Action, or one
	// embedded on something that is not a Hero, still opens the picker
	// pre-linked."
	let open;
	beforeEach(() => {
		game.user = { id: "gm", name: "Narrator", isGM: true };
		game.users = { filter: () => [{ id: "gm", active: true, isGM: true }] };
		game.litmv2 = { fellowship: null };
		Hooks.call.mockReturnValue(true);
		vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
		open = vi.spyOn(CallForRollApp, "open").mockImplementation(() => "picker");
	});

	const action = ({ parent = null, type = "action" } = {}) => ({
		type,
		name: "Strike",
		uuid: "Item.strike",
		parent,
	});
	const embeddedHero = () => {
		const actor = {
			...hero("hero", { ownedBy: ["player"] }),
			setFlag: vi.fn(async () => actor),
			sheet: {
				rollDialogInstance: {
					isOwner: false,
					configureSharedRoll: vi.fn(),
					render: vi.fn(),
					dispatchSync: vi.fn(),
				},
			},
		};
		actors.set("hero", actor);
		return actor;
	};

	it("is the Narrator's button", async () => {
		game.user.isGM = false;
		const owner = embeddedHero();
		const result = await sendRollRequest({ action: action({ parent: owner }) });
		expect(result).toBeNull();
		expect(ui.notifications.warn).toHaveBeenCalledWith("LITM.Actions.gm_only");
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(open).not.toHaveBeenCalled();
	});

	it.each([
		["an Item that is not an Action", action({ type: "theme" })],
		["no Action at all", undefined],
	])("does nothing for %s", async (_label, item) => {
		embeddedHero();
		const result = await sendRollRequest({ action: item });
		expect(result).toBeNull();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(open).not.toHaveBeenCalled();
	});

	it("calls the roll for the Hero an Action is embedded on, with no picker", async () => {
		const owner = embeddedHero();
		const payload = await sendRollRequest({
			action: action({ parent: owner }),
		});
		expect(payload).toMatchObject({
			actorId: "hero",
			actionUuid: "Item.strike",
			title: "Strike",
			// Called for that Hero, stamped with the calling Narrator. Who
			// takes the seat is resolveSharedRollOwner's (roll-authority.test.js).
			narratorUserId: "gm",
		});
		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"openRollDialog",
			expect.objectContaining({ actorId: "hero", actionUuid: "Item.strike" }),
		);
		expect(open).not.toHaveBeenCalled();
	});

	it.each([
		["a world Action", null],
		["an Action embedded on a Challenge", { id: "foe", type: "challenge" }],
		["an Action embedded on the Fellowship", { id: "fel", type: "fellowship" }],
	])("opens the pre-linked picker for %s", async (_label, parent) => {
		actors.set("hero", hero("hero"));
		const result = await sendRollRequest({ action: action({ parent }) });
		expect(result).toBe("picker");
		expect(open).toHaveBeenCalledWith({
			actionUuid: "Item.strike",
			title: "Strike",
		});
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("warns instead of opening an empty picker when the world has no Hero", async () => {
		actors.set("foe", { id: "foe", type: "challenge" });
		const result = await sendRollRequest({ action: action() });
		expect(result).toBeNull();
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Actions.request_no_heroes",
		);
		expect(open).not.toHaveBeenCalled();
	});
});
