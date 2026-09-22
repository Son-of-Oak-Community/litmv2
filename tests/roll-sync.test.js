import { describe, expect, it } from "vitest";
import { RollSync } from "../modules/apps/roll/roll-sync.js";

const initial = () => ({
	actorId: "fellowship",
	ownerId: "gm",
	might: 0,
	tradePower: 0,
	participantIds: ["hero-a", "hero-b"],
	selections: [],
	actionUuid: "Item.old",
	title: "Old action",
});
const select = (sync, id, hero, state = "positive") =>
	sync.edit(
		{
			...sync.view,
			selections: [...sync.view.selections, [id, { state, tagActorId: hero }]],
		},
		false,
	);

describe("owner-authoritative shared-roll synchronization", () => {
	it("merges crossing Might and Trade Power edits and replays unacknowledged edits", () => {
		const owner = new RollSync(initial(), "owner");
		const gm = new RollSync(initial(), "gm");
		const might = gm.edit({ ...gm.view, might: 3 }, false);
		const crossing = owner.edit({ ...owner.view, tradePower: 1 }, true);
		gm.receive(crossing, false);
		expect(gm.view).toMatchObject({ might: 3, tradePower: 1 });
		const final = owner.receive(might, true);
		gm.receive(final, false);
		expect(owner.view).toMatchObject({ might: 3, tradePower: 1 });
		expect(gm.view).toEqual(owner.view);
		expect(gm.pending).toEqual([]);
	});

	it("retains simultaneous group contributions and converges every peer", () => {
		const owner = new RollSync(initial(), "owner");
		const a = new RollSync(initial(), "a");
		const b = new RollSync(initial(), "b");
		const aEdit = select(a, "tag-a", "hero-a");
		const bEdit = select(b, "tag-b", "hero-b");
		const first = owner.receive(aEdit, true);
		b.receive(first, false);
		expect(b.view.selections).toHaveLength(2);
		const final = owner.receive(bEdit, true);
		a.receive(final, false);
		b.receive(final, false);
		expect(owner.view.selections).toHaveLength(2);
		expect(a.view).toEqual(owner.view);
		expect(b.view).toEqual(owner.view);
		// Delayed and duplicated delivery must not erase the second contribution.
		b.receive(first, false);
		owner.receive(aEdit, true);
		expect(b.view).toEqual(owner.view);
	});

	it.each([
		["hero-a", "positive"],
		["hero-b", "scratched"],
	])("enforces merged Hero and burn caps (%s, %s)", (secondHero, secondState) => {
		const owner = new RollSync(initial(), "owner");
		const a = new RollSync(initial(), "a");
		const b = new RollSync(initial(), "b");
		const first = select(a, "tag-a", "hero-a", "scratched");
		const second = select(b, "tag-b", secondHero, secondState);
		owner.receive(first, true);
		b.receive(owner.receive(second, true), false);
		expect(owner.view.selections.map(([id]) => id)).toEqual(["tag-a"]);
		expect(b.view).toEqual(owner.view);
		expect(b.pending).toEqual([]);
	});

	it("synchronizes removals, replacements and late-join action/title state", () => {
		const owner = new RollSync(initial(), "owner");
		const peer = new RollSync(initial(), "peer");
		owner.receive(select(peer, "tag", "hero-a"), true);
		peer.receive(owner.snapshot(), false);
		const removal = peer.edit(
			{
				...peer.view,
				selections: [],
				actionUuid: null,
				title: "",
			},
			false,
		);
		peer.receive(owner.receive(removal, true), false);
		const replacement = owner.edit(
			{
				...owner.view,
				actionUuid: "Item.new",
				title: "New action",
			},
			true,
		);
		const late = new RollSync(initial(), "late");
		late.receive(replacement, false);
		expect(late.view).toMatchObject({
			selections: [],
			actionUuid: "Item.new",
			title: "New action",
		});
	});
});
