import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeElement } from "./__helpers__/dom.js";
import { asUser } from "./__helpers__/users.js";

const make = (id, options = {}) =>
	asUser(
		id,
		() =>
			new LitmRollDialog({
				actorId: "actor",
				ownerId: "gm",
				speaker: {},
				...options,
			}),
	);
/** Each contributing user's own Hero: the only tags the owner takes from them. */
const CHARACTERS = { a: "hero-a", b: "hero-b", "ally-user": "ally" };
let messages;
beforeEach(() => {
	messages = [];
	vi.spyOn(Sockets, "dispatch").mockImplementation((event, data) => {
		if (event === "updateRollDialog")
			messages.push(structuredClone({ ...data, senderId: game.user.id }));
	});
	game.actors.get.mockReturnValue(null);
	// The owner judges an edit by its attested sender; as in asUser, only the
	// id "gm" is a Narrator. A contributor's tags come from their own Hero.
	game.users.get.mockImplementation((id) => ({
		id,
		isGM: id === "gm",
		character: CHARACTERS[id] ? { id: CHARACTERS[id] } : null,
	}));
	// "Helping Each Other" resolves tags to an ally; later tests must not
	// inherit that (mockReset restores the stub's own `() => null`).
	foundry.utils.fromUuidSync.mockReset();
	// requestReseat arms a 5 s fallback. A real one would fire in whichever
	// file runs next in this worker; fake ones end with the test.
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
	vi.useRealTimers();
});
const last = () => messages.at(-1);
const controls = (dialog) => {
	dialog.element = fakeElement();
	dialog._onFirstRender({}, {});
	return (name, value) =>
		dialog.element.emit("change", {
			target: {
				tagName: "INPUT",
				value: String(value),
				matches: (selector) => selector === `input[name='${name}']`,
			},
		});
};

describe("ending a roll", () => {
	// Might is the Narrator's judgement of this one action. A new roll starts
	// from 0; only a roll suspended for approval comes back with it.
	it("starts the next roll from Might 0 once an unrolled roll is closed", () => {
		const roller = make("player", { ownerId: "player" });
		asUser("player", () => controls(roller)("might", 3));
		asUser("player", () => roller.endSharedRoll());
		expect(roller.extractRollData()).toMatchObject({ might: 0 });
	});

	it("keeps the Might of a roll waiting for the Narrator's approval", () => {
		const roller = make("player", { ownerId: "player" });
		asUser("player", () => controls(roller)("might", 3));
		asUser("player", () => roller.endSharedRoll({ preserveAuthority: true }));
		expect(roller.extractRollData()).toMatchObject({ might: 3 });
	});
});

describe("LitmRollDialog sync integration", () => {
	it("keeps the first sheet selection made before the owner is claimed", async () => {
		const roller = make("player", { ownerId: null });
		const viewer = make("gm", { ownerId: "player" });
		asUser("player", () => {
			roller.setCharacterTagState("first-tag", "positive");
			roller.ownerId = "player";
			roller.dispatchSync();
		});
		await asUser("gm", () => viewer.receiveUpdate(last()));
		expect(roller.getSelection("first-tag").state).toBe("positive");
		expect(viewer.getSelection("first-tag").state).toBe("positive");
	});

	it("preserves crossing GM Might and roller Trade Power changes through the real handlers", async () => {
		const roller = make("player", { ownerId: "player" });
		const gm = make("gm", { ownerId: "player" });
		const playerChange = controls(roller);
		const gmChange = controls(gm);
		asUser("gm", () => gmChange("might", 3));
		const mightEdit = last();
		asUser("player", () => playerChange("tradePower", -1));
		const crossing = last();
		await asUser("gm", () => gm.receiveUpdate(crossing));
		expect(gm.extractRollData()).toMatchObject({ might: 3, tradePower: -1 });
		await asUser("player", () => roller.receiveUpdate(mightEdit));
		await asUser("gm", () => gm.receiveUpdate(last()));
		expect(roller.extractRollData()).toMatchObject({
			might: 3,
			tradePower: -1,
		});
		expect(gm.extractRollData()).toMatchObject({ might: 3, tradePower: -1 });
	});

	it("merges two concurrent contributor dispatches at the GM and acknowledges both", async () => {
		// Each contributor offers a tag of their own Hero.
		foundry.utils.fromUuidSync.mockImplementation((uuid) => {
			const hero = { "tag-a": "hero-a", "tag-b": "hero-b" }[uuid];
			return hero
				? { type: "power_tag", parent: { documentName: "Actor", id: hero } }
				: null;
		});
		const gm = make("gm");
		const a = make("a");
		const b = make("b");
		asUser("a", () => {
			a.setSelection("tag-a", "positive", "a", { tagActorId: "hero-a" });
			a.dispatchSync();
		});
		const aEdit = last();
		asUser("b", () => {
			b.setSelection("tag-b", "positive", "b", { tagActorId: "hero-b" });
			b.dispatchSync();
		});
		const bEdit = last();
		await asUser("gm", () => gm.receiveUpdate(aEdit));
		const first = last();
		await asUser("b", () => b.receiveUpdate(first));
		expect(b.selections.size).toBe(2);
		await asUser("gm", () => gm.receiveUpdate(bEdit));
		const final = last();
		await asUser("a", () => a.receiveUpdate(final));
		await asUser("b", () => b.receiveUpdate(final));
		expect([...gm.selections.keys()]).toEqual(["tag-a", "tag-b"]);
		expect(a.selections).toEqual(gm.selections);
		expect(b.selections).toEqual(gm.selections);
	});

	it("syncs Action replacement, clear and title to an already open and a late dialog", async () => {
		const gm = make("gm", { actionUuid: "Item.old", title: "Old" });
		const peer = make("peer");
		asUser("gm", () => gm.dispatchSync());
		await asUser("peer", () => peer.receiveUpdate(last()));
		expect(peer.actionUuid).toBe("Item.old");
		expect(peer.rollName).toBe("Old");
		asUser("gm", () => gm.setAction("Item.new"));
		await asUser("peer", () => peer.receiveUpdate(last()));
		expect(peer.actionUuid).toBe("Item.new");
		expect(peer.rollName).toBe("");
		asUser("gm", () => gm.setAction(null));
		await asUser("peer", () => peer.receiveUpdate(last()));
		expect(peer.actionUuid).toBeNull();
		const late = make("late");
		asUser("gm", () => gm.dispatchSync());
		await asUser("late", () => late.receiveUpdate(last()));
		expect(late.actionUuid).toBeNull();
		expect(late.rollName).toBe("");
	});

	it("keeps the public partial receiveUpdate and dispatchSync API in the same session", async () => {
		const gm = make("gm");
		const peer = make("peer");
		asUser("gm", () => gm.dispatchSync());
		await asUser("peer", () => peer.receiveUpdate(last()));
		const session = last().sync.session;
		await asUser("gm", () => gm.receiveUpdate({ actorId: "actor", might: 6 }));
		asUser("gm", () => gm.dispatchSync());
		expect(last().sync.session).toBe(session);
		await asUser("peer", () => peer.receiveUpdate(last()));
		expect(peer.extractRollData().might).toBe(6);
	});

	it("does not revive a cancelled session from delayed snapshots", async () => {
		const gm = make("gm");
		const peer = make("peer");
		asUser("gm", () => gm.dispatchSync());
		const old = last();
		await asUser("peer", () => peer.receiveUpdate(old));
		peer.invalidateSync();
		peer.rollName = "parked";
		peer.activateSync();
		await asUser("peer", () => peer.receiveUpdate(old));
		expect(peer.rollName).toBe("parked");
	});

	it("knows a new call's session before its first snapshot", async () => {
		const peer = make("peer");
		peer.tabGroups = {};
		asUser("peer", () =>
			peer.configureSharedRoll({
				ownerId: "gm",
				narratorUserId: "gm",
				syncSession: "new-call",
			}),
		);
		expect(peer.syncSession).toBe("new-call");
		expect(peer.matchesSyncSession("old-call")).toBe(false);

		const owner = make("gm");
		owner.tabGroups = {};
		asUser("gm", () =>
			owner.configureSharedRoll({
				ownerId: "gm",
				narratorUserId: "gm",
				syncSession: "new-call",
			}),
		);
		asUser("gm", () => owner.dispatchSync());
		await asUser("peer", () => peer.receiveUpdate(last()));
		expect(peer.syncSession).toBe("new-call");
	});

	it("reopens a parked ordinary roll with its draft and a fresh sync session", async () => {
		const gm = make("gm");
		asUser("gm", () => {
			gm.setSelection("draft", "positive", "gm");
			gm.dispatchSync();
		});
		const oldSession = last().sync.session;
		gm.invalidateSync();
		asUser("gm", () => {
			gm.activateSync();
			gm.dispatchSync();
		});
		expect(last().sync.session).not.toBe(oldSession);
		const viewer = make("peer");
		await asUser("peer", () => viewer.receiveUpdate(last()));
		expect(viewer.getSelection("draft").state).toBe("positive");
	});
});

describe("LitmRollDialog reseat after the owner reloads", () => {
	const SESSION = "call-1";

	/**
	 * The table mid-call: the roller built a draft, the Narrator saw it, then the
	 * roller's client reloaded. `fresh` is the empty dialog that comes back and
	 * has already asked the viewers for the draft.
	 */
	const reloadedMidCall = async () => {
		const before = make("player", { ownerId: "player" });
		const gm = make("gm", { ownerId: "player" });
		before.activateSync(SESSION);
		gm.activateSync(SESSION);
		for (const id of ["t1", "t2"]) {
			asUser("player", () => {
				before.setSelection(id, "positive", "player");
				before.dispatchSync();
			});
			await asUser("gm", () => gm.receiveUpdate(last()));
		}
		const fresh = make("player", { ownerId: "player" });
		fresh.activateSync(SESSION);
		asUser("player", () => fresh.requestReseat());
		return { gm, fresh };
	};

	/** The Narrator's edit reaches the owner before any reply does. */
	const narratorSetsMight = async (gm, fresh) => {
		const gmChange = controls(gm);
		asUser("gm", () => gmChange("might", 3));
		await asUser("player", () => fresh.receiveUpdate(last()));
		// The owner's revision-1 snapshot is stale to a viewer at revision 2.
		await asUser("gm", () => gm.receiveUpdate(last()));
	};

	it("takes the table's draft and keeps the Narrator's early edit", async () => {
		const { gm, fresh } = await reloadedMidCall();
		await narratorSetsMight(gm, fresh);

		asUser("gm", () => gm.dispatchReseat());
		await asUser("player", () => fresh.receiveUpdate(last()));

		expect(fresh.getSelection("t1").state).toBe("positive");
		expect(fresh.getSelection("t2").state).toBe("positive");
		expect(fresh.extractRollData().might).toBe(3);
	});

	it("publishes a snapshot the viewers accept", async () => {
		const { gm, fresh } = await reloadedMidCall();
		await narratorSetsMight(gm, fresh);
		asUser("gm", () => gm.dispatchReseat());
		const reply = last();
		await asUser("player", () => fresh.receiveUpdate(reply));

		// Not older than the revision the viewers already hold, or they drop it.
		expect(last().sync.kind).toBe("snapshot");
		expect(last().sync.revision).toBeGreaterThan(reply.sync.revision);
		await asUser("gm", () => gm.receiveUpdate(last()));

		expect(gm.getSelection("t2").state).toBe("positive");
		expect(gm.extractRollData().might).toBe(3);
	});

	it("gets no answer from a blank viewer, and then publishes its own draft", async () => {
		// Everyone reloaded and the Narrator reopened first: their window is
		// blank, and answering would wipe the call's stamp and Might.
		vi.useFakeTimers();
		try {
			const gm = make("gm", { ownerId: "player" });
			gm.activateSync(SESSION);
			const fresh = make("player", { ownerId: "player" });
			fresh.activateSync(SESSION);
			asUser("player", () => {
				fresh.requestReseat();
				fresh.setSelection("t1", "positive", "player");
				fresh.dispatchSync();
			});
			const sent = messages.length;
			asUser("gm", () => gm.dispatchReseat());
			expect(messages.length).toBe(sent);

			await asUser("player", () => vi.advanceTimersByTimeAsync(60_000));
			expect(last().sync.kind).toBe("snapshot");
			await asUser("gm", () => gm.receiveUpdate(last()));
			expect(gm.getSelection("t1").state).toBe("positive");
		} finally {
			vi.useRealTimers();
		}
	});

	it("doesn't publish an ended roll when the wait runs out", async () => {
		vi.useFakeTimers();
		try {
			const fresh = make("player", { ownerId: "player" });
			fresh.activateSync(SESSION);
			asUser("player", () => fresh.requestReseat());
			asUser("player", () => fresh.endSharedRoll());
			const sent = messages.length;
			await asUser("player", () => vi.advanceTimersByTimeAsync(60_000));
			expect(messages.length).toBe(sent);
		} finally {
			vi.useRealTimers();
		}
	});

	it("is not rolled back by a stray reply when a live owner re-renders", async () => {
		// The sheet asks for a reseat whenever the assigned owner renders the
		// dialog, mid-roll included (a reaction, the HUD strip, the keybinding).
		const owner = make("player", { ownerId: "player" });
		const stray = make("gm", { ownerId: "player" });
		asUser("player", () => {
			owner.setSelection("t1", "positive", "player");
			owner.dispatchSync();
		});
		const held = last().sync.revision;

		asUser("player", () => owner.requestReseat());
		asUser("gm", () => stray.dispatchReseat());
		await asUser("player", () => owner.receiveUpdate(last()));

		expect(owner.getSelection("t1").state).toBe("positive");
		asUser("player", () => owner.dispatchSync());
		expect(last().sync.revision).toBe(held);
	});

	it("carries on with what it has when nobody answers in time", async () => {
		vi.useFakeTimers();
		try {
			const { gm, fresh } = await reloadedMidCall();
			await narratorSetsMight(gm, fresh);
			await vi.advanceTimersByTimeAsync(60_000);

			asUser("gm", () => gm.dispatchReseat());
			await asUser("player", () => fresh.receiveUpdate(last()));

			expect(fresh.getSelection("t1")?.state).toBeFalsy();
			expect(fresh.extractRollData().might).toBe(3);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("Cards Might picker", () => {
	const act = (dialog, name, dataset) =>
		as("gm", () =>
			LitmRollDialog.DEFAULT_OPTIONS.actions[name].call(dialog, null, {
				dataset,
			}),
		);
	const narrator = () => {
		const dialog = make("gm", { ownerId: "player" });
		dialog.render = vi.fn();
		return dialog;
	};
	const might = (dialog) => dialog.extractRollData().might;

	it("subtracts the picked opposition from the Heroes' Might", () => {
		const dialog = narrator();
		act(dialog, "pickMight", { column: "might", value: "3" });
		act(dialog, "pickMight", { column: "size", value: "5" });
		act(dialog, "pickMight", { column: "group", value: "5" });
		expect(might(dialog)).toBe(-7);
	});

	it("drops picks a ± step has moved away from", () => {
		const dialog = narrator();
		act(dialog, "pickMight", { column: "size", value: "5" });
		act(dialog, "mightStep", { step: "1" });
		act(dialog, "pickMight", { column: "group", value: "2" });
		expect(might(dialog)).toBe(-2);
	});

	it("leaves the Might alone when the roller tries it on a called roll", () => {
		const dialog = make("player", { ownerId: "player" });
		dialog.tabGroups = {};
		dialog.render = vi.fn();
		asUser("player", () =>
			dialog.configureSharedRoll({
				ownerId: "player",
				narratorUserId: "gm",
				syncSession: "call",
			}),
		);
		const playerActs = (name, dataset) =>
			asUser("player", () =>
				LitmRollDialog.DEFAULT_OPTIONS.actions[name].call(dialog, null, {
					dataset,
				}),
			);
		const sent = messages.length;
		playerActs("mightStep", { step: "1" });
		playerActs("pickMight", { column: "group", value: "2" });
		expect(might(dialog)).toBe(0);
		// Turned away before anything is sent or redrawn.
		expect(messages.length).toBe(sent);
		expect(dialog.render).not.toHaveBeenCalled();
	});
});

describe("Helping Each Other", () => {
	// p.157: the help is one of the helper's tags, never a status.
	const allyEffect = (type) => {
		foundry.utils.fromUuidSync.mockImplementation(() => ({
			type,
			parent: { documentName: "Actor", id: "ally" },
		}));
		game.actors.get.mockImplementation((id) =>
			id === "ally" ? { type: "hero" } : null,
		);
	};

	it("does not count an ally's status as their help", () => {
		allyEffect("status_tag");
		const dialog = make("player", { ownerId: "player" });
		asUser("player", () =>
			dialog.setSelection("ally-status", "positive", "player"),
		);
		expect(dialog.getSelection("ally-status").helper).toBe(false);
	});

	it("counts an ally's power tag as their help", () => {
		allyEffect("power_tag");
		const dialog = make("player", { ownerId: "player" });
		asUser("player", () =>
			dialog.setSelection("ally-tag", "positive", "player"),
		);
		expect(dialog.getSelection("ally-tag").helper).toBe(true);
	});

	// The owner classifies help itself: an edit that claims `helper: false`
	// for an ally's second tag is still held to the one-tag cap.
	it("caps a contributor's help even when the edit says it is not help", async () => {
		allyEffect("power_tag");
		const owner = make("player", { ownerId: "player" });
		asUser("player", () => owner.dispatchSync());
		const { session } = last().sync;
		const edit = (sequence, id) => ({
			actorId: "actor",
			senderId: "ally-user",
			sync: {
				kind: "edit",
				peerId: "ally-peer",
				sequence,
				session,
				fields: {},
				selections: [
					[
						id,
						{ state: "positive", helper: false, tagActorId: "someone-else" },
					],
				],
			},
		});

		await asUser("player", () => owner.receiveUpdate(edit(1, "ally-tag-1")));
		await asUser("player", () => owner.receiveUpdate(edit(2, "ally-tag-2")));

		expect(owner.getSelection("ally-tag-1")).toMatchObject({
			state: "positive",
			helper: true,
			tagActorId: "ally",
		});
		expect(owner.getSelection("ally-tag-2")?.state).toBeFalsy();
	});
});

// On a called roll the move is the Narrator's; the roller may only make it a
// Sacrifice and go back to the move that was called.
describe("leaving a Sacrifice on a called roll", () => {
	const SESSION = "called-detailed";
	const call = (dialog, user) =>
		asUser(user, () =>
			dialog.configureSharedRoll({
				ownerId: "player",
				narratorUserId: "gm",
				narratorName: "GM",
				type: "tracked",
				syncSession: SESSION,
			}),
		);
	const calledSacrifice = async () => {
		const roller = make("player", { ownerId: "player" });
		const gm = make("gm", { ownerId: "player" });
		roller.tabGroups = gm.tabGroups = {};
		roller.updatePresence = gm.updatePresence = vi.fn(async () => {});
		call(roller, "player");
		call(gm, "gm");
		asUser("player", () => roller.setType("sacrifice"));
		await asUser("gm", () => gm.receiveUpdate(last()));
		return { roller, gm };
	};

	it("still knows the called move after the roller reloads", async () => {
		const { gm } = await calledSacrifice();
		expect(gm.type).toBe("sacrifice");
		const fresh = make("player", { ownerId: "player" });
		fresh.tabGroups = {};
		fresh.updatePresence = vi.fn(async () => {});
		fresh.activateSync(SESSION);
		asUser("player", () => fresh.requestReseat());
		asUser("gm", () => gm.dispatchReseat());
		await asUser("player", () => fresh.receiveUpdate(last()));
		expect(fresh.type).toBe("sacrifice");

		asUser("player", () => fresh.setType("quick"));
		expect(fresh.type).toBe("sacrifice");
		asUser("player", () => fresh.setType("tracked"));
		expect(fresh.type).toBe("tracked");
	});

	it("goes back to the called move, not Quick, when an Action is rolled", async () => {
		const { roller, gm } = await calledSacrifice();
		asUser("player", () => roller.setAction("Actor.a.Item.action"));
		expect(roller.type).toBe("tracked");
		await asUser("gm", () => gm.receiveUpdate(last()));
		expect(gm.type).toBe("tracked");
	});

	it("goes to Quick when an Action is rolled from the roller's own Sacrifice", () => {
		const roller = make("player", { ownerId: "player" });
		roller.tabGroups = {};
		roller.updatePresence = vi.fn(async () => {});
		asUser("player", () => roller.setType("mitigate"));
		asUser("player", () => roller.setType("sacrifice"));
		asUser("player", () => roller.setAction("Actor.a.Item.action"));
		expect(roller.type).toBe("quick");
	});

	it("does not let a roller's update change the called move", async () => {
		const { roller, gm } = await calledSacrifice();
		asUser("player", () => {
			roller.type = "quick";
			roller.dispatchSync();
		});
		await asUser("gm", () => gm.receiveUpdate(last()));
		expect(gm.type).toBe("sacrifice");
	});
});

describe("Secret Grace Bonus", () => {
	it("is the Narrator's; the roller's Sacrifice switch only resets it to 0", async () => {
		const roller = make("player", { ownerId: "player" });
		const gm = make("gm", { ownerId: "player" });
		roller.updatePresence = gm.updatePresence = vi.fn(async () => {});
		const playerChange = controls(roller);
		const gmChange = controls(gm);
		asUser("player", () => roller.setType("sacrifice"));
		await asUser("gm", () => gm.receiveUpdate(last()));
		asUser("gm", () => gmChange("sacrificeBonus", 2));
		await asUser("player", () => roller.receiveUpdate(last()));
		await asUser("gm", () => gm.receiveUpdate(last()));
		expect(roller.extractRollData()).toMatchObject({ sacrificeBonus: 2 });

		asUser("player", () => playerChange("sacrificeBonus", 5));
		asUser("player", () => playerChange("sacrificeLevel", "grave"));
		await asUser("gm", () => gm.receiveUpdate(last()));
		expect(roller.extractRollData()).toMatchObject({ sacrificeBonus: 2 });
		expect(gm.extractRollData()).toMatchObject({
			sacrificeBonus: 2,
			sacrificeLevel: "grave",
		});

		asUser("player", () => roller.setType("quick"));
		asUser("player", () => roller.setType("sacrifice"));
		await asUser("gm", () => gm.receiveUpdate(last()));
		expect(gm.extractRollData()).toMatchObject({ sacrificeBonus: 0 });
	});
});
