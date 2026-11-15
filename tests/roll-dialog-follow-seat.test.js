import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import { Sockets } from "../modules/system/sockets.js";

// `LitmRollDialog#followSeat`: "The seat of a roll this client was watching, or
// holding, passed to someone else (a player took over a roll the GM had open).
// Follow the new owner: snapshots are only accepted from the owner a dialog
// knows about, so a viewer that kept the old one rejected everything the new
// owner published. A viewer also starts unbound... it follows its own session
// only, and the new owner's snapshot names its own. Edits still pending were
// addressed to the old owner, who no longer takes them."

const as = (id, fn) => {
	game.user = { id, isGM: id === "gm" };
	return fn();
};
const make = (id, options = {}) =>
	as(
		id,
		() =>
			new LitmRollDialog({
				actorId: "actor",
				ownerId: "gm",
				speaker: {},
				...options,
			}),
	);

let messages;
beforeEach(() => {
	messages = [];
	vi.spyOn(Sockets, "dispatch").mockImplementation((event, data) => {
		if (event === "updateRollDialog")
			messages.push(structuredClone({ ...data, senderId: game.user.id }));
	});
	game.actors.get.mockReturnValue(null);
	foundry.utils.fromUuidSync.mockReset();
	// A reseat or reload may arm a 5 s fallback; fake ones end with the test.
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	game.actors.get.mockReset();
	foundry.utils.fromUuidSync.mockReset();
});
const last = () => messages.at(-1);

/**
 * The Narrator held the roll and a few edits went by; a viewer follows it. Then
 * a player takes the seat on their own client, a fresh dialog with a session
 * and a revision of its own, and publishes what it holds.
 */
const seatTaken = async () => {
	const gm = make("gm", { ownerId: "gm" });
	const viewer = make("peer", { ownerId: "gm" });
	for (const id of ["t1", "t2", "t3"]) {
		as("gm", () => {
			gm.setSelection(id, "positive", "gm");
			gm.dispatchSync();
		});
		await as("peer", () => viewer.receiveUpdate(last()));
	}
	const player = make("player", { ownerId: "player" });
	as("player", () => {
		player.setSelection("mine", "positive", "player");
		player.dispatchSync();
	});
	return { gm, viewer, player, snapshot: last() };
};

describe("a viewer when the seat passes to a new owner", () => {
	it("rejects the new owner's snapshot until it follows the seat", async () => {
		const { viewer, snapshot } = await seatTaken();
		await as("peer", () => viewer.receiveUpdate(snapshot));
		expect(viewer.getSelection("mine").state).toBeFalsy();
		expect(viewer.getSelection("t1").state).toBe("positive");
	});

	it("takes the new owner's draft once it follows, whatever session and revision it carries", async () => {
		const { viewer, snapshot } = await seatTaken();
		expect(as("peer", () => viewer.followSeat("player"))).toBe(true);
		expect(viewer.ownerId).toBe("player");
		expect(viewer.isOwner).toBe(false);

		await as("peer", () => viewer.receiveUpdate(snapshot));
		expect(viewer.getSelection("mine").state).toBe("positive");
		// The new owner's draft replaces the old one's; it is not merged in.
		expect(viewer.selections.size).toBe(1);
	});

	it("goes on rejecting snapshots from anyone but the owner it follows", async () => {
		const { viewer, snapshot } = await seatTaken();
		as("peer", () => viewer.followSeat("player"));
		await as("peer", () =>
			viewer.receiveUpdate({ ...snapshot, senderId: "gm" }),
		);
		expect(viewer.getSelection("mine").state).toBeFalsy();
	});

	it("drops its pending edits, which were addressed to the old owner", async () => {
		const { viewer, snapshot } = await seatTaken();
		as("peer", () => {
			viewer.setSelection("late", "positive", "peer");
			viewer.dispatchSync();
		});
		expect(last().sync.kind).toBe("edit");
		as("peer", () => viewer.followSeat("player"));
		await as("peer", () => viewer.receiveUpdate(snapshot));
		expect(viewer.getSelection("late").state).toBeFalsy();
	});
});

describe("the old owner when the seat passes to someone else", () => {
	it("steps down and takes the new owner's draft", async () => {
		const { gm, snapshot } = await seatTaken();
		expect(as("gm", () => gm.followSeat("player"))).toBe(true);
		expect(gm.isOwner).toBe(false);
		expect(gm.ownerId).toBe("player");

		await as("gm", () => gm.receiveUpdate(snapshot));
		expect(gm.getSelection("mine").state).toBe("positive");
		expect(gm.selections.size).toBe(1);
	});
});

describe("followSeat declines when there is nothing to follow", () => {
	it("on the new owner's own client, which claims the seat through the owner setter", async () => {
		const { player } = await seatTaken();
		expect(as("player", () => player.followSeat("player"))).toBe(false);
		expect(as("player", () => player.isOwner)).toBe(true);
	});

	it("for a seat nobody names", async () => {
		const { viewer } = await seatTaken();
		expect(as("peer", () => viewer.followSeat(null))).toBe(false);
		expect(as("peer", () => viewer.followSeat(""))).toBe(false);
		expect(viewer.ownerId).toBe("gm");
	});

	it("for the owner the dialog already follows, keeping its pending edits", async () => {
		const { viewer, gm } = await seatTaken();
		as("peer", () => {
			viewer.setSelection("late", "positive", "peer");
			viewer.dispatchSync();
		});
		expect(as("peer", () => viewer.followSeat("gm"))).toBe(false);
		expect(viewer.ownerId).toBe("gm");

		// The owner's next snapshot has not acknowledged the edit yet, so the
		// viewer still shows it on top.
		as("gm", () => gm.dispatchSync());
		await as("peer", () => viewer.receiveUpdate(last()));
		expect(viewer.getSelection("late").state).toBe("positive");
	});

	it("for a dialog nobody has claimed yet", () => {
		const unclaimed = make("peer", { ownerId: null });
		expect(as("peer", () => unclaimed.followSeat("player"))).toBe(false);
		expect(unclaimed.ownerId).toBeNull();
	});

	it("for a tutorial preview", () => {
		const preview = make("peer", { ownerId: "gm", localOnly: true });
		expect(as("peer", () => preview.followSeat("player"))).toBe(false);
		expect(preview.ownerId).toBe("gm");
	});
});
