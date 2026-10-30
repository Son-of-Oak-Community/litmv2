import { beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import { Sockets } from "../modules/system/sockets.js";

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
});
const last = () => messages.at(-1);
const controls = (dialog) => {
	foundry.applications.api.ApplicationV2.prototype._onFirstRender = () => {};
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

describe("LitmRollDialog sync integration", () => {
	it("keeps the first sheet selection made before the owner is claimed", async () => {
		const roller = make("player", { ownerId: null });
		const viewer = make("gm", { ownerId: "player" });
		as("player", () => {
			roller.setCharacterTagState("first-tag", "positive");
			roller.ownerId = "player";
			roller.dispatchSync();
		});
		await as("gm", () => viewer.receiveUpdate(last()));
		expect(roller.getSelection("first-tag").state).toBe("positive");
		expect(viewer.getSelection("first-tag").state).toBe("positive");
	});

	it("preserves crossing GM Might and roller Trade Power changes through the real handlers", async () => {
		const roller = make("player", { ownerId: "player" });
		const gm = make("gm", { ownerId: "player" });
		const playerChange = controls(roller);
		const gmChange = controls(gm);
		as("gm", () => gmChange("might", 3));
		const mightEdit = last();
		as("player", () => playerChange("tradePower", -1));
		const crossing = last();
		await as("gm", () => gm.receiveUpdate(crossing));
		expect(gm.extractRollData()).toMatchObject({ might: 3, tradePower: -1 });
		await as("player", () => roller.receiveUpdate(mightEdit));
		await as("gm", () => gm.receiveUpdate(last()));
		expect(roller.extractRollData()).toMatchObject({
			might: 3,
			tradePower: -1,
		});
		expect(gm.extractRollData()).toMatchObject({ might: 3, tradePower: -1 });
	});

	it("merges two concurrent contributor dispatches at the GM and acknowledges both", async () => {
		const gm = make("gm");
		const a = make("a");
		const b = make("b");
		as("a", () => {
			a.setSelection("tag-a", "positive", "a", { tagActorId: "hero-a" });
			a.dispatchSync();
		});
		const aEdit = last();
		as("b", () => {
			b.setSelection("tag-b", "positive", "b", { tagActorId: "hero-b" });
			b.dispatchSync();
		});
		const bEdit = last();
		await as("gm", () => gm.receiveUpdate(aEdit));
		const first = last();
		await as("b", () => b.receiveUpdate(first));
		expect(b.selections.size).toBe(2);
		await as("gm", () => gm.receiveUpdate(bEdit));
		const final = last();
		await as("a", () => a.receiveUpdate(final));
		await as("b", () => b.receiveUpdate(final));
		expect([...gm.selections.keys()]).toEqual(["tag-a", "tag-b"]);
		expect(a.selections).toEqual(gm.selections);
		expect(b.selections).toEqual(gm.selections);
	});

	it("syncs Action replacement, clear and title to an already open and a late dialog", async () => {
		const gm = make("gm", { actionUuid: "Item.old", title: "Old" });
		const peer = make("peer");
		as("gm", () => gm.dispatchSync());
		await as("peer", () => peer.receiveUpdate(last()));
		expect(peer.actionUuid).toBe("Item.old");
		expect(peer.rollName).toBe("Old");
		as("gm", () => gm.setAction("Item.new"));
		await as("peer", () => peer.receiveUpdate(last()));
		expect(peer.actionUuid).toBe("Item.new");
		expect(peer.rollName).toBe("");
		as("gm", () => gm.setAction(null));
		await as("peer", () => peer.receiveUpdate(last()));
		expect(peer.actionUuid).toBeNull();
		const late = make("late");
		as("gm", () => gm.dispatchSync());
		await as("late", () => late.receiveUpdate(last()));
		expect(late.actionUuid).toBeNull();
		expect(late.rollName).toBe("");
	});

	it("keeps the public partial receiveUpdate and dispatchSync API in the same session", async () => {
		const gm = make("gm");
		const peer = make("peer");
		as("gm", () => gm.dispatchSync());
		await as("peer", () => peer.receiveUpdate(last()));
		const session = last().sync.session;
		await as("gm", () => gm.receiveUpdate({ actorId: "actor", might: 6 }));
		as("gm", () => gm.dispatchSync());
		expect(last().sync.session).toBe(session);
		await as("peer", () => peer.receiveUpdate(last()));
		expect(peer.extractRollData().might).toBe(6);
	});

	it("does not revive a cancelled session from delayed snapshots", async () => {
		const gm = make("gm");
		const peer = make("peer");
		as("gm", () => gm.dispatchSync());
		const old = last();
		await as("peer", () => peer.receiveUpdate(old));
		peer.invalidateSync();
		peer.rollName = "parked";
		peer.activateSync();
		await as("peer", () => peer.receiveUpdate(old));
		expect(peer.rollName).toBe("parked");
	});

	it("knows a new call's session before its first snapshot", async () => {
		const peer = make("peer");
		peer.tabGroups = {};
		as("peer", () =>
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
		as("gm", () =>
			owner.configureSharedRoll({
				ownerId: "gm",
				narratorUserId: "gm",
				syncSession: "new-call",
			}),
		);
		as("gm", () => owner.dispatchSync());
		await as("peer", () => peer.receiveUpdate(last()));
		expect(peer.syncSession).toBe("new-call");
	});

	it("reopens a parked ordinary roll with its draft and a fresh sync session", async () => {
		const gm = make("gm");
		as("gm", () => {
			gm.setSelection("draft", "positive", "gm");
			gm.dispatchSync();
		});
		const oldSession = last().sync.session;
		gm.invalidateSync();
		as("gm", () => {
			gm.activateSync();
			gm.dispatchSync();
		});
		expect(last().sync.session).not.toBe(oldSession);
		const viewer = make("peer");
		await as("peer", () => viewer.receiveUpdate(last()));
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
			as("player", () => {
				before.setSelection(id, "positive", "player");
				before.dispatchSync();
			});
			await as("gm", () => gm.receiveUpdate(last()));
		}
		const fresh = make("player", { ownerId: "player" });
		fresh.activateSync(SESSION);
		as("player", () => fresh.requestReseat());
		return { gm, fresh };
	};

	/** The Narrator's edit reaches the owner before any reply does. */
	const narratorSetsMight = async (gm, fresh) => {
		const gmChange = controls(gm);
		as("gm", () => gmChange("might", 3));
		await as("player", () => fresh.receiveUpdate(last()));
		// The owner's revision-1 snapshot is stale to a viewer at revision 2.
		await as("gm", () => gm.receiveUpdate(last()));
	};

	it("takes the table's draft and keeps the Narrator's early edit", async () => {
		const { gm, fresh } = await reloadedMidCall();
		await narratorSetsMight(gm, fresh);

		as("gm", () => gm.dispatchReseat());
		await as("player", () => fresh.receiveUpdate(last()));

		expect(fresh.getSelection("t1").state).toBe("positive");
		expect(fresh.getSelection("t2").state).toBe("positive");
		expect(fresh.extractRollData().might).toBe(3);
	});

	it("publishes a snapshot the viewers accept", async () => {
		const { gm, fresh } = await reloadedMidCall();
		await narratorSetsMight(gm, fresh);
		as("gm", () => gm.dispatchReseat());
		const reply = last();
		await as("player", () => fresh.receiveUpdate(reply));

		// Not older than the revision the viewers already hold, or they drop it.
		expect(last().sync.kind).toBe("snapshot");
		expect(last().sync.revision).toBeGreaterThan(reply.sync.revision);
		await as("gm", () => gm.receiveUpdate(last()));

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
			as("player", () => {
				fresh.requestReseat();
				fresh.setSelection("t1", "positive", "player");
				fresh.dispatchSync();
			});
			const sent = messages.length;
			as("gm", () => gm.dispatchReseat());
			expect(messages.length).toBe(sent);

			await as("player", () => vi.advanceTimersByTimeAsync(60_000));
			expect(last().sync.kind).toBe("snapshot");
			await as("gm", () => gm.receiveUpdate(last()));
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
			as("player", () => fresh.requestReseat());
			as("player", () => fresh.endSharedRoll());
			const sent = messages.length;
			await as("player", () => vi.advanceTimersByTimeAsync(60_000));
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
		as("player", () => {
			owner.setSelection("t1", "positive", "player");
			owner.dispatchSync();
		});
		const held = last().sync.revision;

		as("player", () => owner.requestReseat());
		as("gm", () => stray.dispatchReseat());
		await as("player", () => owner.receiveUpdate(last()));

		expect(owner.getSelection("t1").state).toBe("positive");
		as("player", () => owner.dispatchSync());
		expect(last().sync.revision).toBe(held);
	});

	it("carries on with what it has when nobody answers in time", async () => {
		vi.useFakeTimers();
		try {
			const { gm, fresh } = await reloadedMidCall();
			await narratorSetsMight(gm, fresh);
			await vi.advanceTimersByTimeAsync(60_000);

			as("gm", () => gm.dispatchReseat());
			await as("player", () => fresh.receiveUpdate(last()));

			expect(fresh.getSelection("t1")?.state).toBeFalsy();
			expect(fresh.extractRollData().might).toBe(3);
		} finally {
			vi.useRealTimers();
		}
	});
});
