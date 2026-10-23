import { describe, expect, it, vi } from "vitest";
import { ChallengeData } from "../modules/actor/challenge/challenge-data.js";
import { fakeActor } from "./__helpers__/factories.js";

// Regression: ChallengeData stores limits in the canonical schema field
// `system.limits`, not in `flags.litmv2.limits` like other actors. The
// LimitsMixin defines `get limits()` on its prototype with no setter, which
// causes Foundry's DataModel `_initialize` to skip assigning the schema-stored
// value as an own property (see foundry/common/abstract/data.mjs:504–514).
// ChallengeData therefore *must* override `get limits()` to read from
// `_source.limits`. If the override is removed, the sheet renders an empty
// limits list and "Add limit" overwrites prior entries on every click.
describe("ChallengeData.limits (regression)", () => {
	const makeChallenge = (sourceLimits) => {
		const model = new ChallengeData({ _source: { limits: sourceLimits } });
		const actor = fakeActor({ type: "challenge" });
		// LimitsMixin's default getter would route to this flag; stub it with
		// a sentinel so the test fails loudly if the override stops winning.
		actor.getFlag = vi.fn(() => [{ id: "flag-sentinel", label: "WRONG" }]);
		model.parent = actor;
		return { model, actor };
	};

	it("reads from _source.limits, not flag-backed actor limits", () => {
		const limit = {
			id: "limit-1",
			label: "Wounded",
			outcome: "Overcome",
			max: 3,
			value: 0,
		};
		const { model, actor } = makeChallenge([limit]);

		expect(model.limits).toEqual([limit]);
		expect(actor.getFlag).not.toHaveBeenCalled();
	});

	it("returns [] when _source.limits is missing", () => {
		const model = new ChallengeData({ _source: {} });
		expect(model.limits).toEqual([]);
	});
});

// Legacy limits stored without an id used to get a fresh randomID() on every
// load until something persisted the array, so a limitId link made in between
// pointed at an id the next load no longer produced.
describe("ChallengeData.migrateData — id-less legacy limits", () => {
	const legacy = () => ({
		limits: [
			{ label: "Wounded", outcome: "Overcome", max: 3, value: 0 },
			{ label: "Wounded", outcome: "Fled", max: 2, value: 1 },
			{ label: "Shaken", outcome: "Overcome", max: 4, value: 0 },
		],
	});

	it("derives the same ids from the same source on every load", () => {
		const first = ChallengeData.migrateData(legacy()).limits.map((l) => l.id);
		const second = ChallengeData.migrateData(legacy()).limits.map((l) => l.id);

		expect(second).toEqual(first);
	});

	it("gives limits with the same label different ids by position", () => {
		const ids = ChallengeData.migrateData(legacy()).limits.map((l) => l.id);

		expect(new Set(ids).size).toBe(3);
	});

	it("keeps the Foundry id shape: 16 alphanumeric characters", () => {
		for (const { id } of ChallengeData.migrateData(legacy()).limits) {
			expect(id).toMatch(/^[a-zA-Z0-9]{16}$/);
		}
	});

	// Foundry runs migrateData on update diffs too (partial cleaning). A limit
	// added there without an id must stay unique, not reuse the id a deleted
	// limit at the same position and label had.
	it("keeps random ids for limits arriving in an update diff", () => {
		const first = ChallengeData.migrateData(legacy(), { partial: true });
		const second = ChallengeData.migrateData(legacy(), { partial: true });

		expect(second.limits[0].id).not.toBe(first.limits[0].id);
	});

	it("leaves an existing id untouched", () => {
		const source = legacy();
		source.limits[0].id = "persisted-id";

		expect(ChallengeData.migrateData(source).limits[0].id).toBe("persisted-id");
	});
});

// A revealed limit is what Limited sheet viewers and the sidebar show players.
describe("ChallengeData.toggleLimitHidden", () => {
	const limit = { id: "lim-1", label: "Harvest", max: 4, value: 1 };
	const other = { id: "lim-2", label: "Flee", max: 2, value: 0 };
	const makeModel = (limits) => {
		const model = new ChallengeData({ _source: { limits } });
		model.setLimits = vi.fn();
		return model;
	};

	it("reveals a limit saved before the field existed (it counts as hidden)", async () => {
		const model = makeModel([limit, other]);
		await model.toggleLimitHidden("lim-1");
		expect(model.setLimits).toHaveBeenCalledWith([{ ...limit, hidden: false }, other]);
	});

	it("hides a revealed limit again", async () => {
		const model = makeModel([{ ...limit, hidden: false }]);
		await model.toggleLimitHidden("lim-1");
		expect(model.setLimits).toHaveBeenCalledWith([{ ...limit, hidden: true }]);
	});

	it("ignores an unknown id", async () => {
		const model = makeModel([limit]);
		await model.toggleLimitHidden("nope");
		expect(model.setLimits).not.toHaveBeenCalled();
	});
});
