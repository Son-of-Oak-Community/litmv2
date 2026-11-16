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
		it("is not taken on a roll its owner holds", async () => {
			const owner = plainRoll("player");
			await deliver(owner, "player", edit({ fields: { might: 6 } }));
			expect(owner.extractRollData().might).toBe(0);
			expect(published(owner, "player")).toMatchObject({ might: 0 });
		});

		it("is not taken on a roll the Narrator holds", async () => {
			const owner = plainRoll("gm");
			await deliver(owner, "gm", edit({ fields: { might: 6 } }));
			expect(owner.extractRollData().might).toBe(0);
			expect(published(owner, "gm")).toMatchObject({ might: 0 });
		});
	});

	describe("the move on a called roll", () => {
		it("is not changed", async () => {
			const owner = calledRoll("player", "tracked");
			await deliver(owner, "player", edit({ fields: { type: "quick" } }));
			expect(owner.type).toBe("tracked");
			expect(published(owner, "player")).toMatchObject({ type: "tracked" });
		});
	});

	describe("the Narrator's stamp", () => {
		it("is not forged onto a roll nobody called, locking its owner out", async () => {
			const owner = plainRoll("player");
			const stamp = { narratorUserId: "peer", narratorName: "Not the GM" };
			await deliver(owner, "player", edit({ fields: { narratorCall: stamp } }));
			expect(owner.narratorCall).toBeNull();
			expect(as("player", () => owner.canSetNarratorFields)).toBe(true);
		});

		it("is not stripped from a called roll, handing its move to the roller", async () => {
			const owner = calledRoll("player");
			await deliver(owner, "player", edit({ fields: { narratorCall: null } }));
			expect(owner.narratorCall).toMatchObject({ narratorUserId: "gm" });
			expect(as("player", () => owner.canSetNarratorFields)).toBe(false);
		});
	});

	describe("Secret Grace", () => {
		it("is not granted to a Sacrifice", async () => {
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
		// Both tags are within the peer's reach (their Hero, "ally"), so only
		// the narrator stamp can stop these edits.
		beforeEach(() => {
			foundry.utils.fromUuidSync.mockImplementation((uuid) =>
				uuid === "peer-tag" || uuid === NARRATOR_TAG
					? { type: "power_tag", parent: { documentName: "Actor", id: "ally" } }
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
		});
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

		it("is not stamped by a peer onto a tag of their own", async () => {
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

		it("is not un-invoked by a peer", async () => {
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

		it("is not flipped to another polarity by a peer", async () => {
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

		it("is not released to the roller by a peer clearing its stamp", async () => {
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
	it("does not set the Might", async () => {
		const owner = plainRoll("player");
		await deliver(owner, "player", {
			actorId: "actor",
			senderId: "peer",
			might: 6,
		});
		expect(owner.extractRollData().might).toBe(0);
	});

	it("does not take the seat", async () => {
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

describe("a non-GM peer's reach", () => {
	// "ally" is the peer's Hero; "ally-tag" is one of its tags.
	beforeEach(() => {
		foundry.utils.fromUuidSync.mockImplementation((uuid) =>
			uuid === "ally-tag"
				? { type: "power_tag", parent: { documentName: "Actor", id: "ally" } }
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
	});

	// A scene tag lives in a compendium and resolves to no actor: claiming it
	// as one's own Hero's must not get it into another player's roll.
	it("does not take a tag that resolves to no actor, whatever it claims", async () => {
		const sceneTag = "Compendium.world.scene-tags.ActiveEffect.x";
		const owner = calledRoll("player");
		await deliver(
			owner,
			"player",
			edit({
				selections: [[sceneTag, { state: "negative", tagActorId: "ally" }]],
			}),
		);
		expect(owner.getSelection(sceneTag)?.state).toBeFalsy();
	});

	it("does not change another user's pick of a tag in reach", async () => {
		const owner = calledRoll("player");
		as("player", () => {
			owner.setSelection("ally-tag", "positive", "other", {
				tagActorId: "ally",
			});
			owner.dispatchSync();
		});
		await deliver(owner, "player", edit({ selections: [["ally-tag", null]] }));
		expect(owner.getSelection("ally-tag")).toMatchObject({
			state: "positive",
			contributorId: "other",
		});
	});
});

describe("a reseat answer to the owner", () => {
	/** The roller's client, freshly back on a called roll at revision 0. */
	const freshOwner = () => calledRoll("player");
	const reseat = (from, state) => ({
		actorId: "actor",
		senderId: from,
		sync: { kind: "reseat", session: SESSION, revision: 3, state },
	});
	const forged = {
		narratorCall: null,
		might: 6,
		type: "quick",
		selections: [["peer-pick", { state: "positive" }]],
	};

	it("is not taken when the owner never asked", async () => {
		const owner = freshOwner();
		await deliver(owner, "player", reseat("peer", forged));
		expect(owner.narratorCall).toMatchObject({ narratorUserId: "gm" });
		expect(owner.extractRollData()).toMatchObject({
			might: 0,
			type: "tracked",
		});
		expect(owner.getSelection("peer-pick")?.state).toBeFalsy();
	});

	// After a reload the owner rebuilds the roll from the draft it saved in
	// its own browser (no other client can write it), so no player's answer
	// is needed, and none is taken.
	const saved = {
		session: SESSION,
		revision: 5,
		state: {
			narratorCall: { narratorUserId: "gm", narratorName: "GM" },
			might: 3,
			type: "tracked",
			modifier: 1,
			selections: [
				["opposition-tag", { state: "negative", narrator: true }],
				["own-pick", { state: "positive" }],
			],
		},
	};
	const restored = () => {
		const owner = freshOwner();
		as("player", () => {
			expect(owner.restoreDraft(saved)).toBe(true);
			owner.requestReseat();
		});
		return owner;
	};

	it("restores both halves from the saved draft and takes no player's answer", async () => {
		const owner = restored();
		await deliver(owner, "player", reseat("peer", forged));
		expect(owner.narratorCall).toMatchObject({ narratorUserId: "gm" });
		expect(owner.extractRollData()).toMatchObject({
			might: 3,
			type: "tracked",
			modifier: 1,
		});
		expect(owner.getSelection("opposition-tag")).toMatchObject({
			state: "negative",
			narrator: true,
		});
		expect(owner.getSelection("own-pick")).toMatchObject({ state: "positive" });
		expect(owner.getSelection("peer-pick")?.state).toBeFalsy();
	});

	it("publishes the restored draft past every answer when no Narrator answers", async () => {
		const owner = restored();
		await deliver(owner, "player", {
			...reseat("peer", forged),
			sync: { ...reseat("peer", forged).sync, revision: 9 },
		});
		await vi.advanceTimersByTimeAsync(5000);
		const published = last().sync;
		expect(published.kind).toBe("snapshot");
		expect(published.revision).toBeGreaterThan(9);
		expect(published.state).toMatchObject({ might: 3, type: "tracked" });
	});

	it("ignores a revision number no viewer could hold", async () => {
		const owner = restored();
		const huge = reseat("peer", forged);
		await deliver(owner, "player", {
			...huge,
			sync: { ...huge.sync, revision: "1e999" },
		});
		await vi.advanceTimersByTimeAsync(5000);
		expect(Number.isSafeInteger(last().sync.revision)).toBe(true);
	});

	it("ignores a draft saved for another roll", () => {
		const owner = freshOwner();
		const restoredOther = as("player", () =>
			owner.restoreDraft({ ...saved, session: "an-older-call" }),
		);
		expect(restoredOther).toBe(false);
		expect(owner.extractRollData().might).toBe(0);
	});

	it("lets the Narrator's answer replace the restored draft", async () => {
		const owner = restored();
		await deliver(owner, "player", reseat("gm", { ...saved.state, might: 5 }));
		expect(owner.extractRollData().might).toBe(5);
	});

	it("takes the Narrator's answer whole", async () => {
		const owner = freshOwner();
		as("player", () => owner.requestReseat());
		await deliver(
			owner,
			"player",
			reseat("gm", {
				...forged,
				narratorCall: { narratorUserId: "gm", narratorName: "GM" },
			}),
		);
		expect(owner.extractRollData()).toMatchObject({ might: 6, type: "quick" });
	});
});

describe("the owner's saved draft", () => {
	// This browser's storage: no other client can write it.
	let store;
	beforeEach(() => {
		store = new Map();
		globalThis.localStorage = {
			getItem: (k) => store.get(k) ?? null,
			setItem: (k, v) => store.set(k, String(v)),
			removeItem: (k) => store.delete(k),
		};
	});
	afterEach(() => {
		delete globalThis.localStorage;
	});
	const KEY = "litmv2.rollDraft.actor";

	it("is saved in this browser as the owner publishes, both halves", () => {
		const owner = calledRoll("player");
		as("player", () => {
			owner.setSelection("own-pick", "positive", "player");
			owner.dispatchSync();
		});
		expect(JSON.parse(store.get(KEY))).toMatchObject({
			session: SESSION,
			state: {
				narratorCall: { narratorUserId: "gm" },
				type: "tracked",
				selections: [
					["own-pick", expect.objectContaining({ state: "positive" })],
				],
			},
		});
	});

	it("is what a reloaded owner restores", () => {
		const before = calledRoll("player");
		as("player", () => {
			before.setSelection("own-pick", "positive", "player");
			before.dispatchSync();
		});
		const after = calledRoll("player");
		expect(as("player", () => after.restoreDraft())).toBe(true);
		expect(after.getSelection("own-pick")).toMatchObject({ state: "positive" });
	});

	it("is not saved for a roll nobody called", () => {
		const owner = plainRoll("player");
		as("player", () => {
			owner.setSelection("own-pick", "positive", "player");
			owner.dispatchSync();
		});
		expect(store.has(KEY)).toBe(false);
	});

	it("is forgotten when the roll ends", () => {
		const owner = calledRoll("player");
		as("player", () => owner.dispatchSync());
		expect(store.has(KEY)).toBe(true);
		as("player", () => owner.endSharedRoll());
		expect(store.has(KEY)).toBe(false);
	});
});
