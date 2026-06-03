import { beforeAll, describe, expect, it, vi } from "vitest";
import { makeTagStringRe } from "../modules/system/config.js";
import { VignetteData } from "../modules/item/vignette/vignette-data.js";

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
});
