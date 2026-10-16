import { describe, expect, it } from "vitest";
import { LitmItem } from "../modules/item/litm-item.js";
import { fakeEffect, fakeItem } from "./__helpers__/factories.js";

const LEGACY = {
	powerTags: [{ name: "Sturdy", isActive: true }],
	weaknessTags: [{ name: "Stubborn", isActive: false }],
	isFellowship: false,
};

/** A theme carrying the stash `migrateData` leaves behind for legacy tag arrays. */
const legacyTheme = (effects = []) => {
	// Foundry's EmbeddedCollection is a Map-backed Collection: it has `.size`
	// and `.some`, not `.length`.
	const collection = Object.defineProperty(effects, "size", {
		get: () => effects.length,
	});
	const item = fakeItem({ type: "theme", name: "Hardened Warrior", effects });
	item.effects = collection;
	item.system = { isScratched: false };
	item.getFlag = (scope, key) =>
		scope === "litmv2" && key === "legacyTags" ? LEGACY : undefined;
	return item;
};

describe("LitmItem.createLegacyEffects (theme)", () => {
	it("converts a legacy theme that has no effects", async () => {
		const item = legacyTheme();

		await LitmItem.createLegacyEffects(item);

		expect(item.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
		const [, created] = item.createEmbeddedDocuments.mock.calls[0];
		expect(created.map((e) => e.name)).toEqual([
			"Sturdy",
			"Stubborn",
			"Hardened Warrior",
		]);
		expect(item.update).toHaveBeenCalledTimes(1);
	});

	it("converts a legacy theme whose only effect is not a theme tag", async () => {
		const item = legacyTheme([fakeEffect({ type: "story_tag" })]);

		await LitmItem.createLegacyEffects(item);

		expect(item.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
		expect(item.update).toHaveBeenCalledTimes(1);
	});

	it.each([
		"power_tag",
		"weakness_tag",
		"fellowship_tag",
	])("leaves a theme that already has a %s alone", async (type) => {
		const item = legacyTheme([fakeEffect({ type })]);

		await LitmItem.createLegacyEffects(item);

		expect(item.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(item.update).not.toHaveBeenCalled();
	});

	it("does nothing without a legacy stash", async () => {
		const item = legacyTheme();
		item.getFlag = () => undefined;

		await LitmItem.createLegacyEffects(item);

		expect(item.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(item.update).not.toHaveBeenCalled();
	});
});
