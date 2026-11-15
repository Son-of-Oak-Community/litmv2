import { describe, expect, it } from "vitest";
import { parseSpendIntent } from "../modules/apps/spend-power.js";
import { fakeElement } from "./__helpers__/dom.js";
import {
	optionRow,
	spendDialog,
	spendForm,
} from "./__helpers__/spend-power.js";

// A chip that names an actor carries its uuid next to its id: an unlinked
// token's actor shares its world actor's id, so the intent has to say which
// document the player actually picked.

const TOKEN_UUID = "Scene.s1.Token.t1.Actor.bandit";

const dialog = spendDialog([
	{ id: "reduce_status", label: "x", cost: 1, hasTier: true },
	{ id: "scratch_tag", label: "x", cost: 2 },
	{
		id: "inflict_status",
		label: "x",
		cost: 1,
		hasTier: true,
		draggable: true,
	},
]);

/** A one-option form, with an optional checked success-target radio. */
const formOf = (li, options) => spendForm([li], options);

describe("parseSpendIntent — actor uuids", () => {
	it("carries actorUuid on each status reduction", () => {
		const item = fakeElement({
			dataset: {
				maxTier: "3",
				effectId: "s1",
				statusName: "enraged",
				actorId: "bandit",
				actorUuid: TOKEN_UUID,
			},
			one: () => ({ textContent: "1" }),
		});
		const section = fakeElement({
			dataset: { statusPicker: "true" },
			all: { ".litm-spend-power__status-item": [item] },
		});
		const li = optionRow(
			{ optionId: "reduce_status", hasTier: "true" },
			{ one: { ".litm-spend-power__entries": section } },
		);

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
		const chip = fakeElement({
			dataset: {
				tagId: "t1",
				tagName: "ambush",
				actorId: "bandit",
				actorUuid: TOKEN_UUID,
				sceneTag: "false",
			},
		});
		const section = fakeElement({
			dataset: { scratchPicker: "true" },
			all: () => [chip],
		});
		const li = optionRow(
			{ optionId: "scratch_tag", hasTier: "false" },
			{ one: { ".litm-spend-power__entries": section } },
		);

		const { options } = parseSpendIntent(formOf(li), dialog);

		expect(options[0].chips[0]).toMatchObject({
			actorId: "bandit",
			actorUuid: TOKEN_UUID,
		});
	});

	function inflictRow(checkedTarget) {
		const row = fakeElement({
			one: {
				".litm-spend-power__entry-name": { value: "dazed" },
				".litm-spend-power__entry-tier": { value: "2" },
			},
		});
		return optionRow(
			{ optionId: "inflict_status", hasTier: "true" },
			{
				one: { "input[name='inflict-target']:checked": checkedTarget },
				all: { ".litm-spend-power__entry": [row] },
			},
		);
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
