import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySpendIntent } from "../modules/apps/spend-power-service.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";

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
		game.actors.get = vi.fn((id) => ({ h1: hero, c1: foe })[id] ?? null);

		const intent = {
			options: [
				{
					kind: "scratchPicker",
					optionId: "scratch_tag",
					label: "LITM.Effects.scratch.action",
					cost: 2,
					chips: [
						{ tagId: "e1", tagName: "tonic", actorId: "h1" },
						{ tagId: "e3", tagName: "reinforcements", actorId: "c1" },
					],
				},
			],
			messageId: null,
			alreadySpent: 0,
		};

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
		game.actors.get = vi.fn(() => null);
		const intent = {
			options: [
				{
					kind: "scratchPicker",
					optionId: "scratch_tag",
					label: "x",
					cost: 2,
					chips: [{ tagId: "missing", tagName: "ghost", actorId: "h1" }],
				},
			],
			messageId: null,
			alreadySpent: 0,
		};
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
		game.actors.get = vi.fn((id) => ({ h1: hero, c1: foe })[id] ?? null);

		const intent = {
			options: [
				{
					kind: "scratchPicker",
					optionId: "scratch_tag",
					label: "x",
					cost: 2,
					chips: [
						{ tagId: "e1", tagName: "tonic", actorId: "h1" }, // resolves
						{ tagId: "gone", tagName: "ghost", actorId: "c1" }, // missing effect
					],
				},
			],
			messageId: null,
			alreadySpent: 0,
		};

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
