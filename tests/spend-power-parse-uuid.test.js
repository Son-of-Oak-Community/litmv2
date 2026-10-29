import { describe, expect, it, vi } from "vitest";
import { parseSpendIntent } from "../modules/apps/spend-power.js";

// A chip that names an actor carries its uuid next to its id: an unlinked
// token's actor shares its world actor's id, so the intent has to say which
// document the player actually picked.

vi.mock("../modules/apps/target-picker.js", () => ({
	getTargetCandidates: vi.fn(() => []),
}));
vi.mock("../modules/apps/story-tags/story-tags-store.js", () => ({
	StoryTagsStore: { loadStoryTags: vi.fn(async () => {}), packStoryTags: [] },
}));

const TOKEN_UUID = "Scene.s1.Token.t1.Actor.bandit";

const dialog = {
	spendingOptions: [
		{ id: "reduce_status", label: "x", cost: 1, hasTier: true },
		{ id: "scratch_tag", label: "x", cost: 2 },
		{
			id: "inflict_status",
			label: "x",
			cost: 1,
			hasTier: true,
			draggable: true,
		},
	],
	messageId: null,
	alreadySpent: 0,
};

/** A one-option form, with an optional checked success-target radio. */
function formOf(li, { successTarget = null } = {}) {
	return {
		querySelectorAll: (selector) =>
			selector === ".litm-spend-power__option" ? [li] : [],
		querySelector: (selector) =>
			selector === "input[name='success-target']:checked"
				? successTarget
				: null,
	};
}

describe("parseSpendIntent — actor uuids", () => {
	it("carries actorUuid on each status reduction", () => {
		const item = {
			dataset: {
				maxTier: "3",
				effectId: "s1",
				statusName: "enraged",
				actorId: "bandit",
				actorUuid: TOKEN_UUID,
			},
			querySelector: () => ({ textContent: "1" }),
		};
		const section = {
			dataset: { statusPicker: "true" },
			querySelectorAll: (s) =>
				s === ".litm-spend-power__status-item" ? [item] : [],
		};
		const li = {
			dataset: { optionId: "reduce_status", hasTier: "true" },
			querySelector: (s) =>
				s === "[data-option-check]"
					? { checked: true }
					: s === ".litm-spend-power__entries"
						? section
						: null,
			querySelectorAll: () => [],
		};

		const { options } = parseSpendIntent(formOf(li), dialog);

		expect(options[0].reductions).toEqual([
			{
				effectId: "s1",
				name: "enraged",
				actorId: "bandit",
				actorUuid: TOKEN_UUID,
				tiers: 2,
			},
		]);
	});

	it("carries actorUuid on each scratch chip", () => {
		const chip = {
			dataset: {
				tagId: "t1",
				tagName: "ambush",
				actorId: "bandit",
				actorUuid: TOKEN_UUID,
				sceneTag: "false",
			},
		};
		const section = {
			dataset: { scratchPicker: "true" },
			querySelectorAll: () => [chip],
		};
		const li = {
			dataset: { optionId: "scratch_tag", hasTier: "false" },
			querySelector: (s) =>
				s === "[data-option-check]"
					? { checked: true }
					: s === ".litm-spend-power__entries"
						? section
						: null,
			querySelectorAll: () => [],
		};

		const { options } = parseSpendIntent(formOf(li), dialog);

		expect(options[0].chips[0]).toMatchObject({
			actorId: "bandit",
			actorUuid: TOKEN_UUID,
		});
	});

	function inflictRow(checkedTarget) {
		const row = {
			querySelector: (s) =>
				s === ".litm-spend-power__entry-name"
					? { value: "dazed" }
					: s === ".litm-spend-power__entry-tier"
						? { value: "2" }
						: null,
		};
		return {
			dataset: { optionId: "inflict_status", hasTier: "true" },
			querySelector: (s) =>
				s === "[data-option-check]"
					? { checked: true }
					: s === "input[name='inflict-target']:checked"
						? checkedTarget
						: null,
			querySelectorAll: (s) => (s === ".litm-spend-power__entry" ? [row] : []),
		};
	}

	it("carries the picked inflict chip's uuid next to its id", () => {
		const li = inflictRow({
			value: "bandit",
			dataset: { actorUuid: TOKEN_UUID },
		});

		const { options } = parseSpendIntent(formOf(li), dialog);

		expect(options[0]).toMatchObject({
			targetActorId: "bandit",
			targetActorUuid: TOKEN_UUID,
		});
	});

	it("keeps 'post to chat' as no target at all", () => {
		const li = inflictRow({ value: "", dataset: {} });

		const { options } = parseSpendIntent(formOf(li), dialog);

		expect(options[0].targetActorId).toBeNull();
		expect(options[0].targetActorUuid).toBeNull();
	});

	it("carries the picked success target's uuid next to its id", () => {
		const li = inflictRow({ value: "", dataset: {} });

		const intent = parseSpendIntent(
			formOf(li, {
				successTarget: { value: "bandit", dataset: { actorUuid: TOKEN_UUID } },
			}),
			dialog,
		);

		expect(intent.targetActorId).toBe("bandit");
		expect(intent.targetActorUuid).toBe(TOKEN_UUID);
	});

	it("has no success target when no chip is checked", () => {
		const li = inflictRow({ value: "", dataset: {} });

		const intent = parseSpendIntent(formOf(li), dialog);

		expect(intent.targetActorId).toBeNull();
		expect(intent.targetActorUuid).toBeNull();
	});
});
