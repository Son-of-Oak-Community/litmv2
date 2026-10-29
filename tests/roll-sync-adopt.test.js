import { describe, expect, it } from "vitest";
import { RollSync } from "../modules/apps/roll/roll-sync.js";

// The owner's client reloads during a called roll and comes back with an
// empty draft. It adopts a viewer's canonical view instead of publishing the
// empty one over the Narrator's move, Might and invocations.
const draft = { type: "tracked", might: 3, selections: [["t1", { state: "positive" }]] };

describe("RollSync.adopt", () => {
	it("takes over a fresh owner's draft, keeping session and revision", () => {
		const owner = new RollSync({ type: "quick", might: 0, selections: [] }, "p2", "call-1");
		expect(owner.adopt({ state: draft, revision: 4, session: "call-1" })).toBe(true);
		expect(owner.view).toEqual(draft);
		const snap = owner.snapshot();
		expect(snap).toMatchObject({ revision: 4, session: "call-1", state: draft });
	});

	it("refuses a draft from another session", () => {
		const owner = new RollSync({ selections: [] }, "p2", "call-1");
		expect(owner.adopt({ state: draft, revision: 4, session: "call-0" })).toBe(false);
	});

	it("refuses once the owner has its own revisions", () => {
		const owner = new RollSync({ selections: [] }, "p2", "call-1");
		owner.edit({ selections: [["t9", { state: "positive" }]] }, true);
		expect(owner.adopt({ state: draft, revision: 4, session: "call-1" })).toBe(false);
	});

	it("is followed by viewers: the adopted snapshot is not older than theirs", () => {
		const viewer = new RollSync({ selections: [] }, "gm", "call-1");
		viewer.receive({ kind: "snapshot", revision: 4, ack: {}, state: draft, session: "call-1" }, false);
		const owner = new RollSync({ selections: [] }, "p2", "call-1");
		owner.adopt({ state: viewer.state, revision: viewer.revision, session: viewer.session });
		viewer.receive(owner.snapshot(), false);
		expect(viewer.view).toEqual(draft);
	});
});

// A reloaded owner is not idle while it waits for a viewer to answer: the
// Narrator's edit can reach it first. The first answer must still win, with the
// early edit replayed on top, instead of every reply being refused because the
// owner already holds a revision.
describe("RollSync.adopt while awaiting a reseat", () => {
	const base = { type: "quick", might: 0, selections: [["t1", { state: "positive" }]] };

	/** A Narrator viewer that holds the canonical draft at revision 8. */
	const narratorView = () => {
		const narrator = new RollSync({ type: "quick", might: 0, selections: [] }, "gm", "call-1");
		narrator.receive({ kind: "snapshot", revision: 8, ack: {}, state: base, session: "call-1" }, false);
		return narrator;
	};
	const reloadedOwner = () => {
		const owner = new RollSync({ type: "quick", might: 0, selections: [] }, "p2", "call-1");
		owner.expectReseat();
		return owner;
	};

	it("adopts the first reply after an early edit and keeps the edit", () => {
		const narrator = narratorView();
		const owner = reloadedOwner();
		const early = narrator.edit({ ...base, might: 3 }, false);
		owner.receive(early, true);

		expect(owner.adopt({ state: base, revision: 8, session: "call-1" })).toBe(true);
		expect(owner.view.might).toBe(3);
		expect(owner.view.selections).toEqual(base.selections);
		// Past the adopted revision, or viewers (at 8) would drop it again.
		expect(owner.snapshot().revision).toBeGreaterThan(8);
	});

	it("replays the owner's own early edits too", () => {
		const owner = reloadedOwner();
		owner.edit({ ...base, selections: [["own", { state: "positive" }]] }, true);

		expect(owner.adopt({ state: base, revision: 8, session: "call-1" })).toBe(true);
		expect(owner.view.selections.map(([id]) => id)).toEqual(["t1", "own"]);
	});

	it("acknowledges the early edit so the Narrator stops replaying it", () => {
		const narrator = narratorView();
		const owner = reloadedOwner();
		owner.receive(narrator.edit({ ...base, might: 3 }, false), true);
		expect(narrator.pending).toHaveLength(1);

		owner.adopt({ state: base, revision: 8, session: "call-1" });
		narrator.receive(owner.snapshot(), false);

		expect(narrator.pending).toHaveLength(0);
		expect(narrator.view.might).toBe(3);
	});

	it("keeps the adopted revision when nothing came in early", () => {
		const owner = reloadedOwner();
		owner.adopt({ state: base, revision: 8, session: "call-1" });
		expect(owner.snapshot().revision).toBe(8);
	});

	it("takes only the first reply", () => {
		const owner = reloadedOwner();
		owner.edit({ ...base, might: 1 }, true);
		expect(owner.adopt({ state: base, revision: 8, session: "call-1" })).toBe(true);
		expect(owner.adopt({ state: { ...base, might: 5 }, revision: 8, session: "call-1" })).toBe(false);
		expect(owner.view.might).toBe(1);
	});

	it("still refuses another session's draft", () => {
		const owner = reloadedOwner();
		owner.edit({ ...base, might: 1 }, true);
		expect(owner.adopt({ state: base, revision: 8, session: "call-0" })).toBe(false);
	});

	it("keeps the old behaviour once the wait is abandoned", () => {
		const owner = reloadedOwner();
		owner.edit({ ...base, might: 1 }, true);
		owner.abandonReseat();
		expect(owner.adopt({ state: base, revision: 8, session: "call-1" })).toBe(false);
		expect(owner.view.might).toBe(1);
	});
});
