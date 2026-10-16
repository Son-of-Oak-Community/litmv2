import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../modules/system/migrations/001-legacy-effects.js";
import { fakeEffect, fakeItem } from "./__helpers__/factories.js";

// Migration 001 must convert a legacy theme unless the theme already has
// theme-tag effects. Any other effect on the item says nothing about whether
// its tags were migrated, so it must not stop the conversion.

// Foundry's EmbeddedCollection is Map-like with `size` and `some`; a plain
// array has no `size`, so the old `effects.size` bail would never trip on one.
class EffectCollection extends Array {
	get size() {
		return this.length;
	}
}
const collection = (effects) => EffectCollection.from(effects);

let AE;
let doc;

const legacyTheme = (effects) => {
	const item = fakeItem({ type: "theme", effects: collection(effects) });
	item.documentName = "Item";
	item.system = {};
	item.getFlag = vi.fn((scope, key) =>
		scope === "litmv2" && key === "legacyTags"
			? { powerTags: [{ name: "Sword", isActive: true }] }
			: undefined,
	);
	return item;
};

const run = async (items) => {
	game.actors = [];
	game.items = items;
	game.scenes = [];
	await migrate();
};

beforeEach(() => {
	vi.clearAllMocks();
	AE = {
		createDocuments: vi.fn().mockResolvedValue([]),
		updateDocuments: vi.fn().mockResolvedValue([]),
	};
	CONFIG.ActiveEffect.documentClass = AE;
	doc = { update: vi.fn().mockResolvedValue(undefined) };
	foundry.utils.fromUuid.mockResolvedValue(doc);
});

describe("migration 001: legacy theme tags", () => {
	it("converts a legacy theme that has no effects", async () => {
		await run([legacyTheme([])]);

		expect(AE.createDocuments).toHaveBeenCalledOnce();
	});

	it.each([
		"status_tag",
		"story_tag",
		"relationship_tag",
	])("converts a legacy theme whose only effect is an unrelated %s", async (type) => {
		const item = legacyTheme([fakeEffect({ type })]);

		await run([item]);

		expect(AE.createDocuments).toHaveBeenCalledOnce();
		const [created, ctx] = AE.createDocuments.mock.calls[0];
		expect(ctx).toEqual({ parentUuid: item.uuid });
		expect(created.map((e) => e.name)).toContain("Sword");
		const [update] = doc.update.mock.calls[0];
		expect(update.flags.litmv2).toHaveProperty("legacyTags");
	});

	it.each([
		"power_tag",
		"weakness_tag",
		"fellowship_tag",
	])("leaves a legacy theme alone once it has a %s effect", async (type) => {
		await run([legacyTheme([fakeEffect({ type })])]);

		expect(AE.createDocuments).not.toHaveBeenCalled();
		expect(doc.update).not.toHaveBeenCalled();
	});
});
