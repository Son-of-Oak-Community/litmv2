import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySpendIntent } from "../modules/apps/spend-power-service.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";
import { scratchIntent, wireActors } from "./__helpers__/spend-power.js";

beforeEach(() => vi.clearAllMocks());

describe("applySpendIntent — scratchPicker", () => {
	it("scratches each selected tag on its owner and charges 2 per tag", async () => {
		const ownTag = fakeEffect({
			id: "e1",
			name: "tonic",
			system: { isScratched: false },
		});
		const foeTag = fakeEffect({
			id: "e3",
			name: "reinforcements",
			system: { isScratched: false },
		});
		const hero = fakeActor({ id: "h1", effects: [ownTag] });
		const foe = fakeActor({ id: "c1", type: "challenge", effects: [foeTag] });
		wireActors(hero, foe);

		const intent = scratchIntent([
			{ tagId: "e1", tagName: "tonic", actorId: "h1" },
			{ tagId: "e3", tagName: "reinforcements", actorId: "c1" },
		]);

		const { results, totalSpent } = await applySpendIntent(hero, intent);

		expect(ownTag.update).toHaveBeenCalledWith({ "system.isScratched": true });
		expect(foeTag.update).toHaveBeenCalledWith({ "system.isScratched": true });
		expect(results[0]).toMatchObject({
			kind: "scratchPicker",
			power: 4,
			tags: [
				{ name: "tonic", type: "story_tag", isScratched: true },
				{ name: "reinforcements", type: "story_tag", isScratched: true },
			],
		});
		expect(totalSpent).toBe(4);
	});

	it("skips chips whose owner or effect cannot be resolved without charging for them", async () => {
		const hero = fakeActor({ id: "h1", effects: [] });
		wireActors();
		const intent = scratchIntent([
			{ tagId: "missing", tagName: "ghost", actorId: "h1" },
		]);
		const { results, totalSpent } = await applySpendIntent(hero, intent);
		// No effect was mutated, so nothing is billed and no chip is reported.
		expect(results[0]).toMatchObject({
			kind: "scratchPicker",
			power: 0,
			tags: [],
		});
		expect(totalSpent).toBe(0);
	});

	it("charges only for the chips that actually scratched", async () => {
		const ownTag = fakeEffect({
			id: "e1",
			name: "tonic",
			system: { isScratched: false },
		});
		const hero = fakeActor({ id: "h1", effects: [ownTag] });
		const foe = fakeActor({ id: "c1", type: "challenge", effects: [] });
		wireActors(hero, foe);

		const intent = scratchIntent([
			{ tagId: "e1", tagName: "tonic", actorId: "h1" }, // resolves
			{ tagId: "gone", tagName: "ghost", actorId: "c1" }, // missing effect
		]);

		const { results, totalSpent } = await applySpendIntent(hero, intent);
		expect(ownTag.update).toHaveBeenCalledWith({ "system.isScratched": true });
		expect(results[0]).toMatchObject({
			kind: "scratchPicker",
			power: 2,
			tags: [{ name: "tonic", type: "story_tag", isScratched: true }],
		});
		expect(totalSpent).toBe(2);
	});
});
