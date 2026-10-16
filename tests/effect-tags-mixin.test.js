import { describe, expect, it, vi } from "vitest";
import { EffectTagsMixin } from "../modules/actor/mixins/effect-tags-mixin.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

// addStatus calls statusTagEffect, which reads game.i18n.localize for the
// default name fallback. We always pass an explicit name in tests, but stub
// the namespace so any incidental read is harmless.
globalThis.game = { i18n: { localize: (k) => k } };

// Build a fake TypeDataModel-like base so the mixin can extend it.
class BaseModel {
	prepareDerivedData() {}
}
const TaggedModel = EffectTagsMixin(BaseModel);

const buildModel = (actor) => {
	const model = new TaggedModel();
	model.parent = actor;
	return model;
};

describe("EffectTagsMixin.storyTags / statusEffects", () => {
	it("partitions story_tag and status_tag effects from all applicable sources", () => {
		const backpack = fakeItem({
			type: "backpack",
			effects: [fakeEffect({ type: "story_tag", name: "lantern" })],
		});
		const actor = fakeActor({
			effects: [
				fakeEffect({ type: "story_tag", name: "blessed" }),
				fakeEffect({ type: "status_tag", name: "tired" }),
			],
			items: [backpack],
		});
		const model = buildModel(actor);
		model.prepareDerivedData();

		expect(model.storyTags.map((e) => e.name).sort()).toEqual([
			"blessed",
			"lantern",
		]);
		expect(model.statusEffects.map((e) => e.name)).toEqual(["tired"]);
	});

	it("partitions eagerly in prepareDerivedData; re-runs refresh the cache", () => {
		const actor = fakeActor({
			effects: [fakeEffect({ type: "story_tag", name: "a" })],
		});
		const model = buildModel(actor);
		model.prepareDerivedData();
		const first = model.storyTags;
		expect(model.storyTags).toBe(first);

		// Add an effect — cache is stale until prepareDerivedData re-runs
		actor.effects.push(fakeEffect({ type: "story_tag", name: "b" }));
		expect(model.storyTags).toBe(first);

		model.prepareDerivedData();
		expect(model.storyTags).not.toBe(first);
		expect(model.storyTags.map((e) => e.name)).toEqual(["a", "b"]);
	});
});

describe("EffectTagsMixin.addStatus", () => {
	it("creates a status_tag effect via the parent actor", async () => {
		const actor = fakeActor();
		const model = buildModel(actor);

		await model.addStatus("Tired");

		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith(
			"ActiveEffect",
			expect.arrayContaining([
				expect.objectContaining({ type: "status_tag", name: "Tired" }),
			]),
		);
	});

	it("forwards tiers and img options into the effect data", async () => {
		const actor = fakeActor();
		const model = buildModel(actor);
		const tiers = [false, false, true, false, false, false];

		await model.addStatus("Bruised", { tiers, img: "icons/svg/x.svg" });

		const [, [data]] = actor.createEmbeddedDocuments.mock.calls[0];
		expect(data.system.tiers).toBe(tiers);
		expect(data.img).toBe("icons/svg/x.svg");
	});

	it("omits img and uses the factory's default tiers when no options are passed", async () => {
		const actor = fakeActor();
		const model = buildModel(actor);

		await model.addStatus("Tired");

		const [, [data]] = actor.createEmbeddedDocuments.mock.calls[0];
		// img absent -> Foundry uses field initial; we don't synthesise undefined
		expect("img" in data).toBe(false);
		// Default tiers come from statusTagEffect factory: 6-element all-false
		expect(data.system.tiers).toEqual([
			false,
			false,
			false,
			false,
			false,
			false,
		]);
	});

	it("creates a new status_tag at the given tier when no same-named status exists", async () => {
		const actor = fakeActor({ effects: [] });
		const model = buildModel(actor);

		await model.addStatus("Shaken", { tier: 2 });

		expect(actor.createEmbeddedDocuments).toHaveBeenCalledOnce();
		const [docType, [data]] = actor.createEmbeddedDocuments.mock.calls[0];
		expect(docType).toBe("ActiveEffect");
		expect(data.type).toBe("status_tag");
		expect(data.name).toBe("Shaken");
		expect(data.system.tiers).toEqual([
			false,
			true,
			false,
			false,
			false,
			false,
		]);
	});

	it("passes isHidden and limitId through to the created effect", async () => {
		const actor = fakeActor({ effects: [] });
		const model = buildModel(actor);

		await model.addStatus("Bound", {
			tier: 1,
			isHidden: true,
			limitId: "limit-1",
		});

		const [, [data]] = actor.createEmbeddedDocuments.mock.calls[0];
		expect(data.system.isHidden).toBe(true);
		expect(data.system.limitId).toBe("limit-1");
	});

	it("stacks onto an existing same-named status via calculateMark (case-insensitive)", async () => {
		const mergedTiers = [false, false, true, false, false, false];
		const existing = fakeEffect({
			type: "status_tag",
			name: "Shaken",
			system: {
				tiers: [false, true, false, false, false, false],
				calculateMark: vi.fn().mockReturnValue(mergedTiers),
			},
		});
		const actor = fakeActor({ effects: [existing] });
		const model = buildModel(actor);

		await model.addStatus("shaken", { tier: 3 }); // case-insensitive match

		expect(existing.system.calculateMark).toHaveBeenCalledWith(3);
		expect(actor.updateEmbeddedDocuments).toHaveBeenCalledOnce();
		const [docType, updates] = actor.updateEmbeddedDocuments.mock.calls[0];
		expect(docType).toBe("ActiveEffect");
		expect(updates[0]._id).toBe(existing.id);
		expect(updates[0]["system.tiers"]).toBe(mergedTiers);
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});

	describe("stacking onto an existing status with a limitId", () => {
		const unlinked = (limitId = null) =>
			fakeEffect({
				type: "status_tag",
				name: "Wounded",
				system: {
					limitId,
					tiers: [true, false, false, false, false, false],
					calculateMark: vi
						.fn()
						.mockReturnValue([false, true, false, false, false, false]),
				},
			});

		it("links an unlinked existing status to the passed limit", async () => {
			const existing = unlinked();
			const actor = fakeActor({ effects: [existing] });
			const model = buildModel(actor);

			await model.addStatus("Wounded", { tier: 2, limitId: "limit-1" });

			const [, [update]] = actor.updateEmbeddedDocuments.mock.calls[0];
			expect(update).toMatchObject({
				_id: existing.id,
				"system.limitId": "limit-1",
			});
			expect(update["system.tiers"]).toBeDefined();
		});

		it("keeps an existing link to a different limit", async () => {
			// One status feeds one limit. A status already counting towards another
			// limit stays put; the stack still lands.
			const actor = fakeActor({ effects: [unlinked("limit-other")] });
			const model = buildModel(actor);

			await model.addStatus("Wounded", { tier: 2, limitId: "limit-1" });

			const [, [update]] = actor.updateEmbeddedDocuments.mock.calls[0];
			expect("system.limitId" in update).toBe(false);
			expect(update["system.tiers"]).toBeDefined();
		});

		it("leaves a status already linked to that limit alone", async () => {
			const actor = fakeActor({ effects: [unlinked("limit-1")] });
			const model = buildModel(actor);

			await model.addStatus("Wounded", { tier: 2, limitId: "limit-1" });

			const [, [update]] = actor.updateEmbeddedDocuments.mock.calls[0];
			expect("system.limitId" in update).toBe(false);
		});

		it("does not link anything when no limitId is passed", async () => {
			const actor = fakeActor({ effects: [unlinked()] });
			const model = buildModel(actor);

			await model.addStatus("Wounded", { tier: 2 });

			const [, [update]] = actor.updateEmbeddedDocuments.mock.calls[0];
			expect("system.limitId" in update).toBe(false);
		});
	});

	it("routes stacking updates through existing.parent, not just the actor", async () => {
		// A status that lives on an embedded item should be updated via that
		// item's updateEmbeddedDocuments, even when addStatus is called on the
		// actor's data model.
		const mergedTiers = [false, false, true, false, false, false];
		const existing = fakeEffect({
			type: "status_tag",
			name: "Bound",
			system: {
				tiers: [false, true, false, false, false, false],
				calculateMark: vi.fn().mockReturnValue(mergedTiers),
			},
		});
		const item = fakeItem({ effects: [existing] });
		const actor = fakeActor({ items: [item] });
		const model = buildModel(actor);

		await model.addStatus("Bound", { tier: 3 });

		expect(item.updateEmbeddedDocuments).toHaveBeenCalledOnce();
		expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

describe("EffectTagsMixin.removeStatus", () => {
	it("deletes the effect from its actual parent (an embedded item, not the actor)", async () => {
		const effect = fakeEffect({
			id: "eff-1",
			type: "status_tag",
			name: "tired",
		});
		const item = fakeItem({ effects: [effect] });
		const actor = fakeActor({ items: [item] });
		const model = buildModel(actor);

		await model.removeStatus("eff-1");

		expect(item.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			"eff-1",
		]);
		expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("deletes via the actor when the effect lives directly on the actor", async () => {
		const effect = fakeEffect({ id: "eff-2", type: "status_tag" });
		const actor = fakeActor({ effects: [effect] });
		const model = buildModel(actor);

		await model.removeStatus("eff-2");

		expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			"eff-2",
		]);
	});

	it("is a no-op when no effect matches the id", async () => {
		const actor = fakeActor({ effects: [fakeEffect({ id: "other" })] });
		const model = buildModel(actor);

		await model.removeStatus("missing");

		expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});
});
