import { beforeAll, describe, expect, it, vi } from "vitest";
import { syncTagStringEffects } from "../modules/item/action/tag-string.js";
import { makeTagStringRe } from "../modules/system/config.js";

// The test shim leaves CONFIG.litmv2.tagStringRe null; install the real
// getter (a fresh regex per use — the global `g` flag is stateful).
beforeAll(() => {
	Object.defineProperty(CONFIG.litmv2, "tagStringRe", {
		configurable: true,
		get: () => makeTagStringRe(),
	});
});

const fakeDocEffect = ({ id, name, type, system = {}, addonId = null }) => ({
	id,
	name,
	type,
	system,
	getFlag: (_ns, key) => (key === "addonId" ? addonId : null),
});

const fakeDoc = (effects = []) => ({
	effects,
	createEmbeddedDocuments: vi.fn().mockResolvedValue([]),
	updateEmbeddedDocuments: vi.fn().mockResolvedValue([]),
	deleteEmbeddedDocuments: vi.fn().mockResolvedValue([]),
});

describe("syncTagStringEffects", () => {
	it("creates story and status effects from markup, skipping weakness/limit tokens", async () => {
		const doc = fakeDoc();
		await syncTagStringEffects(
			doc,
			"[rope!], [drenched-2], [-tired], [doom:4]",
		);

		const [, created] = doc.createEmbeddedDocuments.mock.calls[0];
		expect(created.map((c) => c.type)).toEqual(["story_tag", "status_tag"]);
		expect(created[0]).toMatchObject({
			name: "rope",
			system: { isSingleUse: true },
		});
		expect(created[1].system.tiers).toEqual([
			false,
			true,
			false,
			false,
			false,
			false,
		]);
	});

	it("deletes effects no longer present in the markup", async () => {
		const doc = fakeDoc([
			fakeDocEffect({
				id: "fx-1",
				name: "rope",
				type: "story_tag",
				system: { isSingleUse: false },
			}),
			fakeDocEffect({
				id: "fx-2",
				name: "stale",
				type: "story_tag",
				system: { isSingleUse: false },
			}),
		]);
		await syncTagStringEffects(doc, "[rope]");

		expect(doc.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			"fx-2",
		]);
		expect(doc.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("never touches addon-managed effects", async () => {
		const doc = fakeDoc([
			fakeDocEffect({
				id: "fx-addon",
				name: "sharp claws",
				type: "story_tag",
				system: { isSingleUse: false },
				addonId: "addon-1",
			}),
		]);
		await syncTagStringEffects(doc, "[rope]");

		// The addon effect is excluded from reconciliation entirely: not
		// deleted (despite missing from the markup) and not matched.
		expect(doc.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		const [, created] = doc.createEmbeddedDocuments.mock.calls[0];
		expect(created).toHaveLength(1);
		expect(created[0].name).toBe("rope");
	});
});
