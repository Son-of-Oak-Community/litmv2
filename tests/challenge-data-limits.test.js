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
