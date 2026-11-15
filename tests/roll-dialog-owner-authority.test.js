import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import { Sockets } from "../modules/system/sockets.js";

// The owner is the one writer of a shared roll (`RollSync`): it merges the
// `edit` packets its peers send and publishes the canonical result. CLAUDE.md
// splits a roll's authority in two. The move type and the Might are the
// Narrator's half, locked for everyone else once a roll is called; Secret
// Grace is the Narrator's alone on every roll; a selection stamped
// `narrator: true` stays locked for non-GMs. And "the markup is not the
// boundary": the template, the change handlers and the sender's own
// `#dispatchUpdate` all refuse, but a peer is free to hand-craft the packet,
// so the owner has to refuse too.
//
// Every forged packet below is sent by a non-GM, non-owner user, with the
// session and a fresh sequence number the owner would accept from anyone, so
// the only thing that can stop it is an authority check. Each refusal has a
// positive control: the same packet shape from the Narrator, or a plain tag
// from the same peer, does land.

const SESSION = "call-1";
const USERS = {
	gm: { id: "gm", isGM: true },
	player: { id: "player", isGM: false },
	peer: { id: "peer", isGM: false, character: { id: "ally" } },
};

const as = (id, fn) => {
	game.user = { id, isGM: USERS[id]?.isGM ?? false };
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
let sequence;
beforeEach(() => {
	messages = [];
	sequence = 0;
	vi.spyOn(Sockets, "dispatch").mockImplementation((event, data) => {
		if (event === "updateRollDialog")
			messages.push(structuredClone({ ...data, senderId: game.user.id }));
	});
	game.actors.get.mockReturnValue(null);
	game.users.get.mockImplementation((id) => USERS[id]);
	foundry.utils.fromUuidSync.mockReset();
	// requestReseat arms a 5 s fallback; a real timer would fire in whichever
	// file runs next in this worker.
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	game.actors.get.mockReset();
	game.users.get.mockReset();
	foundry.utils.fromUuidSync.mockReset();
});
const last = () => messages.at(-1);

/** The change handler the dialog installs on its element, driven by name. */
const controls = (dialog) => {
	let change;
	dialog.element = {
		addEventListener: (event, listener) => {
			if (event === "change") change = listener;
		},
		querySelector: () => null,
		querySelectorAll: () => [],
	};
	dialog._onFirstRender({}, {});
	return (name, value) =>
		change({
			target: {
				tagName: "INPUT",
				value: String(value),
				matches: (selector) => selector === `input[name='${name}']`,
			},
		});
};

/** The dialog of `userId`, who holds a roll nobody called. */
const plainRoll = (userId) => {
	const dialog = make(userId, { ownerId: userId });
	dialog.tabGroups = {};
	dialog.updatePresence = vi.fn(async () => {});
	dialog.activateSync(SESSION);
	return dialog;
};

/** `userId`'s dialog on a roll the Narrator (`gm`) called for `player`. */
const calledRoll = (userId, type = "tracked") => {
	const dialog = make(userId, { ownerId: "player" });
	dialog.tabGroups = {};
	dialog.updatePresence = vi.fn(async () => {});
	as(userId, () =>
		dialog.configureSharedRoll({
			ownerId: "player",
			narratorUserId: "gm",
			narratorName: "GM",
			type,
			syncSession: SESSION,
		}),
	);
	return dialog;
};

/** An `edit` packet as the server would hand it to the owner. */
const edit = ({ from = "peer", fields = {}, selections = [] } = {}) => ({
	actorId: "actor",
	senderId: from,
	sync: {
		kind: "edit",
		peerId: `${from}-client`,
		sequence: ++sequence,
		session: SESSION,
		fields,
		selections,
	},
});
const deliver = (owner, ownerId, packet) =>
	as(ownerId, () => owner.receiveUpdate(packet));

/** What the owner would tell the table now. */
const published = (owner, ownerId) => {
	as(ownerId, () => owner.dispatchSync());
	return last().sync.state;
};

describe("the owner's merge: positive controls", () => {
	// Helping Each Other (p.156-157): the peer offers one tag of their own
	// Hero, "ally", on a roll that is not theirs. This is the one thing a
	// non-owner, non-GM peer may send, so the harness is proven by it.
	it("merges a peer's tag from their own Hero as help", async () => {
		foundry.utils.fromUuidSync.mockImplementation((uuid) =>
			uuid === "ally-tag"
				? {
						type: "power_tag",
						parent: { documentName: "Actor", id: "ally" },
					}
				: null,
		);
		game.actors.get.mockImplementation((id) =>
			id === "ally"
				? {
						id: "ally",
						type: "hero",
						testUserPermission: (user) => user.id === "peer",
					}
				: null,
		);
		const owner = calledRoll("player");
		await deliver(
			owner,
			"player",
			edit({
				selections: [
					["ally-tag", { state: "positive", contributorId: "peer" }],
				],
			}),
		);
		expect(owner.getSelection("ally-tag")).toMatchObject({
			state: "positive",
			helper: true,
			tagActorId: "ally",
		});
	});

	it("takes the Narrator's Might, move and Secret Grace on a called roll", async () => {
		const owner = calledRoll("player");
		const gm = calledRoll("gm");
		const gmChange = controls(gm);

		as("gm", () => gmChange("might", 3));
		await deliver(owner, "player", last());
		expect(owner.extractRollData().might).toBe(3);

		as("gm", () => gm.setType("quick"));
		await deliver(owner, "player", last());
		expect(owner.type).toBe("quick");

		// Secret Grace is only read from a Sacrifice.
		as("player", () => owner.setType("sacrifice"));
		await as("gm", () => gm.receiveUpdate(last()));
		as("gm", () => gmChange("sacrificeBonus", 2));
		await deliver(owner, "player", last());
		expect(owner.extractRollData().sacrificeBonus).toBe(2);
	});

	it("keeps a tag the Narrator invoked on a called roll stamped as theirs", async () => {
		const owner = calledRoll("player");
		const gm = calledRoll("gm");
		as("gm", () => gm.setCharacterTagState("opposition-tag", "negative"));
		await deliver(owner, "player", last());
		expect(owner.getSelection("opposition-tag")).toMatchObject({
			state: "negative",
			narrator: true,
		});
	});
});

describe("a non-GM peer's forged edit to the owner", () => {
	describe("Might", () => {
		// PRODUCT BUG: the owner merges `fields.might` from any sender (RollSync#apply spreads it; receiveUpdate only checks senderId for snapshots).
		it.fails("is not taken on a roll its owner holds", async () => {
			const owner = plainRoll("player");
			await deliver(owner, "player", edit({ fields: { might: 6 } }));
			expect(owner.extractRollData().might).toBe(0);
			expect(published(owner, "player")).toMatchObject({ might: 0 });
		});

		// PRODUCT BUG: same merge, GM-owned roll: a non-GM peer sets the Narrator's Might.
		it.fails("is not taken on a roll the Narrator holds", async () => {
			const owner = plainRoll("gm");
			await deliver(owner, "gm", edit({ fields: { might: 6 } }));
			expect(owner.extractRollData().might).toBe(0);
			expect(published(owner, "gm")).toMatchObject({ might: 0 });
		});
	});

	describe("the move on a called roll", () => {
		// PRODUCT BUG: the owner merges `fields.type` from a non-GM peer, overriding the called move.
		it.fails("is not changed", async () => {
			const owner = calledRoll("player", "tracked");
			await deliver(owner, "player", edit({ fields: { type: "quick" } }));
			expect(owner.type).toBe("tracked");
			expect(published(owner, "player")).toMatchObject({ type: "tracked" });
		});
	});

	describe("the Narrator's stamp", () => {
		// PRODUCT BUG: `fields.narratorCall` is merged from any sender, so a peer can stamp a roll as Narrator-called and lock its owner out of move and Might.
		it.fails("is not forged onto a roll nobody called, locking its owner out", async () => {
			const owner = plainRoll("player");
			const stamp = { narratorUserId: "peer", narratorName: "Not the GM" };
			await deliver(owner, "player", edit({ fields: { narratorCall: stamp } }));
			expect(owner.narratorCall).toBeNull();
			expect(as("player", () => owner.canSetNarratorFields)).toBe(true);
		});

		// PRODUCT BUG: `fields.narratorCall: null` from a peer removes the Narrator's stamp, unlocking move and Might for the roller.
		it.fails("is not stripped from a called roll, handing its move to the roller", async () => {
			const owner = calledRoll("player");
			await deliver(owner, "player", edit({ fields: { narratorCall: null } }));
			expect(owner.narratorCall).toMatchObject({ narratorUserId: "gm" });
			expect(as("player", () => owner.canSetNarratorFields)).toBe(false);
		});
	});

	describe("Secret Grace", () => {
		// PRODUCT BUG: `fields.sacrificeBonus` is merged from a non-GM peer; Secret Grace is the Narrator's alone.
		it.fails("is not granted to a Sacrifice", async () => {
			const owner = calledRoll("player");
			as("player", () => owner.setType("sacrifice"));
			await deliver(owner, "player", edit({ fields: { sacrificeBonus: 6 } }));
			expect(owner.extractRollData()).toMatchObject({
				type: "sacrifice",
				sacrificeBonus: 0,
			});
			expect(published(owner, "player")).toMatchObject({ sacrificeBonus: 0 });
		});
	});

	describe("a selection marked narrator: true", () => {
		const NARRATOR_TAG = "opposition-tag";
		/** A called roll with the Narrator's invocation already in it. */
		const withInvocation = async () => {
			const owner = calledRoll("player");
			const gm = calledRoll("gm");
			as("gm", () => gm.setCharacterTagState(NARRATOR_TAG, "negative"));
			await deliver(owner, "player", last());
			expect(owner.getSelection(NARRATOR_TAG).narrator).toBe(true);
			return owner;
		};
		const peerEntry = (entry) => ({
			state: "positive",
			contributorId: "peer",
			...entry,
		});

		// PRODUCT BUG: a selection entry with `narrator: true` from a non-GM peer is stored as sent.
		it.fails("is not stamped by a peer onto a tag of their own", async () => {
			const owner = calledRoll("player");
			await deliver(
				owner,
				"player",
				edit({
					selections: [["peer-tag", peerEntry({ narrator: true })]],
				}),
			);
			expect(owner.getSelection("peer-tag").narrator).not.toBe(true);
		});

		// PRODUCT BUG: a peer's `[id, null]` removes a Narrator-stamped selection; the lock is only applied client-side by #canModifyTag.
		it.fails("is not un-invoked by a peer", async () => {
			const owner = await withInvocation();
			await deliver(
				owner,
				"player",
				edit({ selections: [[NARRATOR_TAG, null]] }),
			);
			expect(owner.getSelection(NARRATOR_TAG)).toMatchObject({
				state: "negative",
				narrator: true,
			});
		});

		// PRODUCT BUG: a peer overwrites a Narrator-stamped selection's polarity.
		it.fails("is not flipped to another polarity by a peer", async () => {
			const owner = await withInvocation();
			await deliver(
				owner,
				"player",
				edit({
					selections: [[NARRATOR_TAG, peerEntry({ narrator: true })]],
				}),
			);
			expect(owner.getSelection(NARRATOR_TAG).state).toBe("negative");
		});

		// PRODUCT BUG: a peer's entry with `narrator: false` clears the Narrator's stamp.
		it.fails("is not released to the roller by a peer clearing its stamp", async () => {
			const owner = await withInvocation();
			await deliver(
				owner,
				"player",
				edit({
					selections: [
						[NARRATOR_TAG, peerEntry({ state: "negative", narrator: false })],
					],
				}),
			);
			expect(owner.getSelection(NARRATOR_TAG).narrator).toBe(true);
		});
	});
});

describe("a non-GM peer's partial update to the owner", () => {
	// `receiveUpdate` without a `sync` is the public API modules and macros
	// call on their own client, but the socket hands the same method whatever a
	// peer emitted, so a packet with no `sync` reaches it too.
	// PRODUCT BUG: a packet with no `sync` goes through receiveUpdate's partial-update branch, which applies any field from any sender.
	it.fails("does not set the Might", async () => {
		const owner = plainRoll("player");
		await deliver(owner, "player", {
			actorId: "actor",
			senderId: "peer",
			might: 6,
		});
		expect(owner.extractRollData().might).toBe(0);
	});

	// PRODUCT BUG: the partial-update branch also applies `ownerId`: a non-GM peer takes the seat from the real owner.
	it.fails("does not take the seat", async () => {
		const owner = plainRoll("player");
		await deliver(owner, "player", {
			actorId: "actor",
			senderId: "peer",
			ownerId: "peer",
		});
		expect(owner.ownerId).toBe("player");
		expect(as("player", () => owner.isOwner)).toBe(true);
	});
});

describe("a non-owner peer's own client", () => {
	// The sender-side half of the same rule (`#dispatchUpdate`): the honest
	// client never sends what the owner would have to refuse.
	it("sends its tag but not a local move change on a called roll", () => {
		const viewer = calledRoll("peer");
		as("peer", () => {
			viewer.setSelection("peer-tag", "positive", "peer");
			viewer.type = "quick";
			viewer.dispatchSync();
		});
		expect(last().sync.selections.map(([id]) => id)).toEqual(["peer-tag"]);
		expect(last().sync.fields).not.toHaveProperty("type");
	});

	it("sends nothing for a Might typed into its own window", () => {
		const viewer = calledRoll("peer");
		const sent = messages.length;
		as("peer", () => controls(viewer)("might", 4));
		expect(messages.length).toBe(sent);
		expect(viewer.extractRollData().might).toBe(0);
	});
});
