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
