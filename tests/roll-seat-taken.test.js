import { beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import { registerActorHooks } from "../modules/system/hooks/actor-hooks.js";
import { Sockets } from "../modules/system/sockets.js";

// A player may take the seat of a roll the GM opened from their Hero's sheet.
// Every client then hears the presence flag change. The GM steps down, and a
// third client that was only watching has to follow the new owner too, or it
// rejects everything the new owner publishes.

const ACTOR_ID = "actor";

const as = (id, fn) => {
	game.user = { id, isGM: id === "gm" };
	return fn();
};
const make = (id, options = {}) =>
	as(
		id,
		() =>
			new LitmRollDialog({
				actorId: ACTOR_ID,
				ownerId: "gm",
				speaker: {},
				...options,
			}),
	);

let messages;
let syncRequests;
const last = () => messages.at(-1);

beforeEach(() => {
	messages = [];
	syncRequests = [];
	vi.spyOn(Sockets, "dispatch").mockImplementation((event, data) => {
		if (event === "updateRollDialog")
			messages.push(structuredClone({ ...data, senderId: game.user.id }));
		if (event === "requestRollDialogSync")
			syncRequests.push({ ...data, senderId: game.user.id });
	});
	game.actors.get.mockReturnValue(null);
	game.litmv2 = {};
	Hooks.on.mockClear();
	registerActorHooks();
});

/** The presence-flag update, as one client's `updateActor` hooks see it. */
const seatTaken = (clientId, dialog, newOwnerId) => {
	const flag = { ownerId: newOwnerId, openedAt: 1, type: "quick" };
	const actor = {
		id: ACTOR_ID,
		type: "hero",
		getFlag: () => flag,
		sheet: { hasRollDialog: true, rollDialogInstance: dialog },
	};
	const changes = { flags: { litmv2: { rollDialogOwner: flag } } };
	as(clientId, () => {
		for (const [hook, fn] of Hooks.on.mock.calls)
			if (hook === "updateActor") fn(actor, changes, {}, newOwnerId);
	});
};

/** The GM opened the roll and built a draft; both viewers have seen it. */
const gmHoldsTheRoll = async (viewers) => {
	const gm = make("gm", { ownerId: "gm" });
	for (const id of ["t1", "t2"]) {
		as("gm", () => {
			gm.setSelection(id, "positive", "gm");
			gm.dispatchSync();
		});
		for (const [clientId, dialog] of Object.entries(viewers))
			await as(clientId, () => dialog.receiveUpdate(last()));
	}
	return gm;
};

/** What `renderRollDialog` does for a player taking over: claim, then publish. */
const playerTakesOver = (player) =>
	as("player", () => {
		player.ownerId = "player";
		player.setSelection("mine", "positive", "player");
		player.dispatchSync();
	});

describe("a player takes the seat from the GM", () => {
	it("keeps the sync revision and session the table already follows", async () => {
		const player = make("player", { ownerId: "gm" });
		await gmHoldsTheRoll({ player });
		const held = last().sync;

		playerTakesOver(player);

		// Restarting at revision 0 would have every viewer drop the new owner's
		// snapshots as older than the last one they saw.
		expect(last().sync.session).toBe(held.session);
		expect(last().sync.revision).toBeGreaterThan(held.revision);
	});

	it("is followed by a third viewer, who was bound to the GM's roll", async () => {
		const player = make("player", { ownerId: "gm" });
		const third = make("third", { ownerId: "gm" });
		const gm = await gmHoldsTheRoll({ player, third });

		playerTakesOver(player);
		const takeover = last();
		seatTaken("gm", gm, "player");
		seatTaken("third", third, "player");
		await as("third", () => third.receiveUpdate(takeover));

		expect(third.ownerId).toBe("player");
		expect(third.getSelection("mine").state).toBe("positive");
	});

	it("is followed by a third viewer when the player's dialog was fresh", async () => {
		// A player who never saw the GM's snapshots has no session to carry, so
		// the new owner names a session of its own.
		const player = make("player", { ownerId: null });
		const third = make("third", { ownerId: "gm" });
		const gm = await gmHoldsTheRoll({ third });

		playerTakesOver(player);
		const takeover = last();
		seatTaken("gm", gm, "player");
		seatTaken("third", third, "player");
		await as("third", () => third.receiveUpdate(takeover));

		expect(third.getSelection("mine").state).toBe("positive");
	});

	it("asks the new owner to publish again if the viewer heard the flag last", async () => {
		const player = make("player", { ownerId: "gm" });
		const third = make("third", { ownerId: "gm" });
		await gmHoldsTheRoll({ player, third });

		playerTakesOver(player);
		// The snapshot outran the flag update: still addressed to the old owner.
		await as("third", () => third.receiveUpdate(last()));
		expect(third.getSelection("mine")?.state).toBeFalsy();

		seatTaken("third", third, "player");
		expect(syncRequests).toContainEqual(
			expect.objectContaining({ actorId: ACTOR_ID, senderId: "third" }),
		);
		as("player", () => player.dispatchSync());
		await as("third", () => third.receiveUpdate(last()));

		expect(third.getSelection("mine").state).toBe("positive");
	});

	it("steps the GM down and has it ask for the new owner's draft", async () => {
		const player = make("player", { ownerId: "gm" });
		const gm = await gmHoldsTheRoll({ player });
		playerTakesOver(player);
		const takeover = last();

		seatTaken("gm", gm, "player");
		await as("gm", () => gm.receiveUpdate(takeover));

		expect(gm.isOwner).toBe(false);
		expect(gm.ownerId).toBe("player");
		expect(syncRequests).toContainEqual(
			expect.objectContaining({ actorId: ACTOR_ID, senderId: "gm" }),
		);
		expect(gm.getSelection("mine").state).toBe("positive");
	});

	it("never promotes the client the flag names", async () => {
		const player = make("player", { ownerId: "gm" });
		await gmHoldsTheRoll({ player });

		seatTaken("player", player, "player");

		expect(player.ownerId).toBe("gm");
	});

	it("leaves a dialog that already follows the new owner alone", async () => {
		const player = make("player", { ownerId: "gm" });
		const third = make("third", { ownerId: "player" });
		await gmHoldsTheRoll({ player });

		seatTaken("third", third, "player");

		expect(third.ownerId).toBe("player");
		expect(syncRequests).toEqual([]);
	});
});
