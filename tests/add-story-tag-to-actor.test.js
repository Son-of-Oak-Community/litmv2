import { beforeEach, describe, expect, it, vi } from "vitest";
import { storyTagEffect } from "../modules/active-effects/effect-factories.js";
import { HeroData } from "../modules/actor/hero/hero-data.js";
import { EffectTagsMixin } from "../modules/actor/mixins/effect-tags-mixin.js";
import { fakeActor, fakeItem } from "./__helpers__/factories.js";

// addStoryTag routing: heroes reroute story tags into their backpack item so
// the effects transfer; every other actor type creates them directly on the
// actor. These exercise the real HeroData override and the EffectTagsMixin
// default — not test-local copies of their logic.

class BaseModel {
	prepareDerivedData() {}
}
const TaggedModel = EffectTagsMixin(BaseModel);

const makeHero = ({ items = [] } = {}) => {
	const actor = fakeActor({ type: "hero", items });
	const model = new HeroData();
	model.parent = actor;
	return { model, actor };
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("HeroData.addStoryTag", () => {
	it("routes a hero's story tag through the backpack item, not the actor", async () => {
		const backpack = fakeItem({ type: "backpack" });
		const { model, actor } = makeHero({ items: [backpack] });
		const data = storyTagEffect({ name: "lantern" });

		await model.addStoryTag(data);

		expect(backpack.createEmbeddedDocuments).toHaveBeenCalledWith(
			"ActiveEffect",
			[data],
		);
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("does not set `transfer` explicitly — it is the Foundry default", async () => {
		const backpack = fakeItem({ type: "backpack" });
		const { model } = makeHero({ items: [backpack] });

		await model.addStoryTag(storyTagEffect({ name: "lantern" }));

		const [, [created]] = backpack.createEmbeddedDocuments.mock.calls[0];
		expect(created).not.toHaveProperty("transfer");
	});

	it("warns and bails when a hero has no backpack", async () => {
		const { model, actor } = makeHero({ items: [] });

		const result = await model.addStoryTag(storyTagEffect({ name: "x" }));

		expect(result).toBeUndefined();
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.warn_no_backpack",
		);
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

describe("EffectTagsMixin.addStoryTag (default)", () => {
	it("creates the effect directly on a non-hero actor", async () => {
		const actor = fakeActor({ type: "challenge" });
		const model = new TaggedModel();
		model.parent = actor;
		const data = storyTagEffect({ name: "ambush" });

		await model.addStoryTag(data);

		expect(actor.createEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			{ ...data, transfer: false },
		]);
	});
});
