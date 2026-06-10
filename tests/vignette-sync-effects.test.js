import { beforeAll, describe, expect, it, vi } from "vitest";
import { VignetteData } from "../modules/item/vignette/vignette-data.js";
import { makeTagStringRe } from "../modules/system/config.js";

// In production CONFIG.litmv2.tagStringRe is a getter returning a fresh regex
// (the global `g` flag needs a new instance per use); the test shim leaves it
// null, so install the real getter here.
beforeAll(() => {
	Object.defineProperty(CONFIG.litmv2, "tagStringRe", {
		configurable: true,
		get: () => makeTagStringRe(),
	});
});

// Build a fake vignette + invoke the instance method against it. The method
// only touches `this.parent` (the doc) and `this.consequences`.
function runSync(consequences, effects = []) {
	const doc = {
		effects,
		createEmbeddedDocuments: vi.fn().mockResolvedValue([]),
		updateEmbeddedDocuments: vi.fn().mockResolvedValue([]),
		deleteEmbeddedDocuments: vi.fn().mockResolvedValue([]),
	};
	const promise = VignetteData.prototype.syncEffectsFromConsequences.call({
		parent: doc,
		consequences,
	});
	return { doc, promise };
}

describe("VignetteData.syncEffectsFromConsequences", () => {
	it("creates a status_tag (not a story_tag) for [name-N] markup", async () => {
		// Regression: the old destructure read the regex's `!` group as the
		// separator, so `[drenched-2]` silently became a story_tag and the
		// status never materialized.
		const { doc, promise } = runSync(["Heroes wake [drenched-2]"]);
		await promise;

		expect(doc.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
		const [, created] = doc.createEmbeddedDocuments.mock.calls[0];
		expect(created).toHaveLength(1);
		expect(created[0].type).toBe("status_tag");
		expect(created[0].name).toBe("drenched");
		expect(created[0].system.tiers).toEqual([
			false,
			true,
			false,
			false,
			false,
			false,
		]);
	});

	it("creates a story_tag for plain [name] markup", async () => {
		const { doc, promise } = runSync(["A [muddy path] is left behind"]);
		await promise;

		const [, created] = doc.createEmbeddedDocuments.mock.calls[0];
		expect(created[0].type).toBe("story_tag");
		expect(created[0].name).toBe("muddy path");
	});

	it("updates an existing status_tag's tiers to match the markup", async () => {
		const existing = {
			id: "fx-1",
			name: "drenched",
			type: "status_tag",
			system: { tiers: [true, false, false, false, false, false] },
		};
		const { doc, promise } = runSync(["Still [drenched-3]"], [existing]);
		await promise;

		expect(doc.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(doc.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
		const [, updates] = doc.updateEmbeddedDocuments.mock.calls[0];
		expect(updates[0]).toEqual({
			_id: "fx-1",
			"system.tiers": [false, false, true, false, false, false],
		});
	});

	it("updates isSingleUse when [name] markup becomes [name!]", async () => {
		// Regression: the old vignette-local diff never updated isSingleUse,
		// so editing [rope] → [rope!] silently kept the old effect's false.
		const existing = {
			id: "fx-1",
			name: "rope",
			type: "story_tag",
			system: { isSingleUse: false },
		};
		const { doc, promise } = runSync(["A [rope!] dangles down"], [existing]);
		await promise;

		expect(doc.createEmbeddedDocuments).not.toHaveBeenCalled();
		const [, updates] = doc.updateEmbeddedDocuments.mock.calls[0];
		expect(updates[0]).toEqual({ _id: "fx-1", "system.isSingleUse": true });
	});

	it("matches case-insensitively and updates the stored name", async () => {
		// Regression: the old vignette-local diff keyed case-sensitively, so
		// re-casing a tag deleted and recreated it (losing the effect id).
		const existing = {
			id: "fx-1",
			name: "muddy path",
			type: "story_tag",
			system: { isSingleUse: false },
		};
		const { doc, promise } = runSync(["A [Muddy Path] remains"], [existing]);
		await promise;

		expect(doc.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(doc.createEmbeddedDocuments).not.toHaveBeenCalled();
		const [, updates] = doc.updateEmbeddedDocuments.mock.calls[0];
		expect(updates[0]).toEqual({ _id: "fx-1", name: "Muddy Path" });
	});

	it("ignores duplicate markup entries after the first", async () => {
		const { doc, promise } = runSync([
			"Heroes wake [drenched-2]",
			"Still [drenched-2] from the night",
		]);
		await promise;

		const [, created] = doc.createEmbeddedDocuments.mock.calls[0];
		expect(created).toHaveLength(1);
	});
});
