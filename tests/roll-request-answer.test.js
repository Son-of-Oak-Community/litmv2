import { beforeEach, describe, expect, it, vi } from "vitest";
import { answerRollRequest } from "../modules/apps/roll/roll-request.js";
import { Sockets } from "../modules/system/sockets.js";

// The Narrator's "Call" button on a player's "I'd like to roll" card. Deleting
// the card is the claim on it, but the ask is the player's: it must not be
// lost when the call never opens, and it must not wipe a roll that is already
// open for that Hero.

const CARD = {
	_id: "msg-1",
	author: "player",
	whisper: ["gm"],
	speaker: { actor: "hero" },
	content: "<button data-click='call-requested-roll'></button>",
	flags: { litmv2: { rollRequestFrom: { actorId: "hero" } } },
};

let actor;
let dialog;
let liveFlag;

function makeCard({ deleteResult = "claimed" } = {}) {
	const card = {
		id: "msg-1",
		getFlag: vi.fn((scope, key) =>
			scope === "litmv2" && key === "rollRequestFrom"
				? CARD.flags.litmv2.rollRequestFrom
				: undefined,
		),
		toObject: () => structuredClone(CARD),
		delete: vi.fn(() =>
			deleteResult === "claimed"
				? Promise.resolve(card)
				: Promise.reject(new Error("does not exist")),
		),
	};
	return card;
}

beforeEach(() => {
	vi.clearAllMocks();
	liveFlag = null;
	dialog = {
		isOwner: false,
		configureSharedRoll: vi.fn(),
		render: vi.fn(),
		dispatchSync: vi.fn(),
	};
	actor = {
		id: "hero",
		name: "Gerrin",
		testUserPermission: (user) => user.id === "player",
		getFlag: vi.fn(() => liveFlag),
		setFlag: vi.fn(async () => actor),
		sheet: { rollDialogInstance: dialog },
	};
	game.user = { id: "gm", name: "Narrator", isGM: true };
	game.users = {
		filter: (fn) =>
			[
				{ id: "gm", active: true, isGM: true },
				{ id: "player", active: true, isGM: false },
			].filter(fn),
	};
	game.litmv2 = { fellowship: null };
	game.actors.get.mockReturnValue(actor);
	Hooks.call.mockReturnValue(true);
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("answerRollRequest", () => {
	it("claims the card and opens the roll for the Hero", async () => {
		const card = makeCard();
		await answerRollRequest(card);

		expect(card.delete).toHaveBeenCalledTimes(1);
		expect(actor.setFlag).toHaveBeenCalledTimes(1);
		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"openRollDialog",
			expect.objectContaining({ actorId: "hero", ownerId: "player" }),
		);
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("steps aside when a roll is already open for the Hero", async () => {
		liveFlag = { ownerId: "player", openedAt: 1, type: "quick" };
		const card = makeCard();
		await answerRollRequest(card);

		// Reopening would re-stamp the flag and reset the player's selections.
		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(dialog.configureSharedRoll).not.toHaveBeenCalled();
		// The stale card goes away and the Narrator is told why.
		expect(card.delete).toHaveBeenCalled();
		expect(ui.notifications.info).toHaveBeenCalledWith(
			"LITM.Ui.roll_request_superseded",
		);
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("puts the card back when litm.narratorCall vetoes the call", async () => {
		Hooks.call.mockReturnValue(false);
		const card = makeCard();
		await answerRollRequest(card);

		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(foundry.documents.ChatMessage.create).toHaveBeenCalledTimes(1);
		const [restored] = foundry.documents.ChatMessage.create.mock.calls[0];
		expect(restored).toMatchObject({
			whisper: CARD.whisper,
			speaker: CARD.speaker,
			content: CARD.content,
			flags: CARD.flags,
		});
		// A new document gets a new id; keeping the old one would collide with
		// the delete still in flight on other clients.
		expect(restored).not.toHaveProperty("_id");
	});

	it("puts the card back when opening the roll throws", async () => {
		actor.setFlag.mockRejectedValue(new Error("flag write refused"));
		const card = makeCard();
		await expect(answerRollRequest(card)).resolves.toBeUndefined();

		expect(foundry.documents.ChatMessage.create).toHaveBeenCalledTimes(1);
		expect(console.error).toHaveBeenCalled();
	});

	it("does nothing when another Narrator already took the card", async () => {
		const card = makeCard({ deleteResult: "gone" });
		await answerRollRequest(card);

		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("opens once for a double click on the same card", async () => {
		const card = makeCard();
		await Promise.all([answerRollRequest(card), answerRollRequest(card)]);

		expect(card.delete).toHaveBeenCalledTimes(1);
		expect(actor.setFlag).toHaveBeenCalledTimes(1);
	});

	it("is a Narrator's button", async () => {
		game.user.isGM = false;
		const card = makeCard();
		await answerRollRequest(card);

		expect(card.delete).not.toHaveBeenCalled();
		expect(actor.setFlag).not.toHaveBeenCalled();
	});
});
