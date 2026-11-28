import { describe, expect, it, vi } from "vitest";
import { ChallengeData } from "../modules/actor/challenge/challenge-data.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

// Issue #240: an addon's limit was display-only. The sidebar, the limit
// picker and the status recalc read the limits a Challenge tracks, so the
// addon's limit has to be among them, and a write has to land on the addon.

const limit = (id, label, max, value = 0) => ({ id, label, max, value });

const addon = (name, limits) => {
	const item = fakeItem({ type: "addon", name });
	item.system = {
		ratingBonus: 0,
		categories: [],
		limits,
		might: [],
		tags: "",
		threats: [],
	};
	return item;
};

const tracked = ({ effects = [] } = {}) => {
	const armoured = addon("Armoured", [
		limit("add-1", "wounded", 5),
		{ ...limit("add-2", "Cleanse", 4), hidden: true },
	]);
	const model = new ChallengeData({
		rating: 1,
		category: "",
		might: [],
		tags: "",
		_source: { limits: [limit("own-1", "Wounded", 3, 2)] },
	});
	model.parent = fakeActor({ type: "challenge", items: [armoured], effects });
	model.parent.system = model;
	model.parent.update = vi.fn();
	model.parent.updateEmbeddedDocuments = vi.fn();
	model.prepareDerivedData();
	return { model, armoured };
};

describe("ChallengeData: an addon's limits are tracked", () => {
	it("lists a limit only the addon has after the Challenge's own", () => {
		const { model } = tracked();

		expect(model.allLimits).toEqual([
			limit("own-1", "Wounded", 3, 2),
			{ ...limit("add-2", "Cleanse", 4), hidden: true },
		]);
	});

	it("keeps the stored max and reports the higher one as effective", () => {
		const { model } = tracked();

		expect(model.allLimits[0].max).toBe(3);
		expect(model.getEffectiveMax(model.allLimits[0])).toBe(5);
		expect(model.getEffectiveMax(model.allLimits[1])).toBe(4);
	});

	it("carries an addon limit's visibility into the derived list", () => {
		const { model } = tracked();

		expect(model.derivedLimits).toEqual([
			limit("own-1", "Wounded", 5, 2),
			{ ...limit("add-2", "Cleanse", 4), hidden: true },
		]);
	});

	it("skips an addon limit whose id is already tracked", () => {
		const twin = addon("Twin", [limit("add-2", "Renamed", 2)]);
		const { model } = tracked();
		model.parent.items.push(twin);

		expect(model.allLimits.map((l) => l.label)).toEqual(["Wounded", "Cleanse"]);
	});

	it("writes an addon's limit to the addon, own limits to the Challenge", async () => {
		const { model, armoured } = tracked();
		const [own, cleanse] = model.allLimits;

		await model.setLimits([own, { ...cleanse, value: 2, hidden: false }]);

		expect(model.parent.update).toHaveBeenCalledWith({
			"system.limits": [own],
		});
		expect(model.parent.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
			{
				_id: armoured.id,
				"system.limits": [
					limit("add-1", "wounded", 5),
					{ ...limit("add-2", "Cleanse", 4, 2), hidden: false },
				],
			},
		]);
	});

	it("leaves the addon alone when its limit is unchanged or left out", async () => {
		const { model } = tracked();

		await model.setLimits(model.allLimits);
		await model.setLimits([...model.limits, limit("new-1", "Scared", 3)]);

		expect(model.parent.updateEmbeddedDocuments).not.toHaveBeenCalled();
		expect(model.parent.update).toHaveBeenLastCalledWith({
			"system.limits": [
				limit("own-1", "Wounded", 3, 2),
				limit("new-1", "Scared", 3),
			],
		});
	});

	it("reveals an addon's limit", async () => {
		const { model, armoured } = tracked();

		await model.toggleLimitHidden("add-2");

		expect(model.parent.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
			{
				_id: armoured.id,
				"system.limits": [
					limit("add-1", "wounded", 5),
					{ ...limit("add-2", "Cleanse", 4), hidden: false },
				],
			},
		]);
	});

	it("advances an addon's limit and stops at its max", async () => {
		const { model, armoured } = tracked();
		Hooks.callAll.mockClear();

		const result = await model.advanceLimit("add-2", 6);

		expect(result).toMatchObject({ value: 4, max: 4, reached: true });
		expect(
			Hooks.callAll.mock.calls.filter(([name]) => name === "litm.limitReached"),
		).toHaveLength(1);
		expect(
			model.parent.updateEmbeddedDocuments.mock.calls[0][1][0],
		).toMatchObject({
			_id: armoured.id,
			"system.limits": [{}, { id: "add-2", value: 4, advanced: 4 }],
		});
	});

	it("advances an own limit up to the max an addon raised it to", async () => {
		const { model } = tracked();

		const result = await model.advanceLimit("own-1", 6);

		expect(result).toMatchObject({ value: 5, max: 5, reached: true });
		expect(model.parent.update).toHaveBeenCalledWith({
			"system.limits": [{ ...limit("own-1", "Wounded", 3, 5), advanced: 3 }],
		});
	});

	it("answers null for a limit nobody tracks", async () => {
		const { model } = tracked();

		expect(await model.advanceLimit("nope", 1)).toBeNull();
		expect(model.parent.update).not.toHaveBeenCalled();
	});

	it("leaves an immunity (max 0) alone", async () => {
		const { model, armoured } = tracked();
		armoured.system.limits[1].max = 0;

		const result = await model.advanceLimit("add-2", 1);

		expect(result).toMatchObject({ immune: true, value: 0 });
		expect(model.parent.update).not.toHaveBeenCalled();
		expect(model.parent.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("removes an addon's limit from the addon", async () => {
		const { model, armoured } = tracked();

		await model.removeLimit("add-2");

		expect(model.parent.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
			{ _id: armoured.id, "system.limits": [limit("add-1", "wounded", 5)] },
		]);
	});

	it("removes an own limit from the Challenge", async () => {
		const { model } = tracked();

		await model.removeLimit("own-1");

		expect(model.parent.update).toHaveBeenCalledWith({ "system.limits": [] });
		expect(model.parent.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

// A status dropped on the addon's limit in the sidebar links to it by id; the
// recalc has to find the limit, store its new value and announce it reached.
describe("ChallengeData.recalculateLimitValues: an addon's limit", () => {
	const tiers = (n) => Array.from({ length: 6 }, (_, i) => i + 1 === n);
	const status = (n) =>
		fakeEffect({
			type: "status_tag",
			system: { limitId: "add-2", tiers: tiers(n) },
		});
	const reachedCalls = () =>
		Hooks.callAll.mock.calls.filter(([name]) => name === "litm.limitReached");

	it("stores the linked statuses' tier on the addon", async () => {
		const { model, armoured } = tracked({ effects: [status(2)] });
		Hooks.callAll.mockClear();

		await model.recalculateLimitValues();

		expect(model.parent.updateEmbeddedDocuments).toHaveBeenCalledWith("Item", [
			{
				_id: armoured.id,
				"system.limits": [
					limit("add-1", "wounded", 5),
					{ ...limit("add-2", "Cleanse", 4, 2), hidden: true },
				],
			},
		]);
		expect(reachedCalls()).toHaveLength(0);
	});

	it("announces the addon's limit reached, once", async () => {
		const { model } = tracked({ effects: [status(4)] });
		Hooks.callAll.mockClear();

		const { reached } = await model.recalculateLimitValues();

		expect(reached).toHaveLength(1);
		expect(reachedCalls()).toHaveLength(1);
		expect(reachedCalls()[0][1].limit).toMatchObject({
			id: "add-2",
			label: "Cleanse",
			value: 4,
			max: 4,
		});
	});
});
