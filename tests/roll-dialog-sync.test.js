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
