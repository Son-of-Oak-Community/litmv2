import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeroData } from "../modules/actor/hero/hero-data.js";
import { fakeActor } from "./__helpers__/factories.js";

// recordMomentOfFulfillment — Core Book p.193 promise mechanics, moved off
// the hero sheet into the data layer. The stub base constructor only does
// Object.assign; each test seeds the fields the method reads.
const makeHero = ({ mof = [], promise = 0, pendingPromise = 0 } = {}) => {
	const actor = fakeActor({ type: "hero" });
	const model = new HeroData();
	model.parent = actor;
	model.mof = mof;
	model.promise = promise;
	model.pendingPromise = pendingPromise;
	return { model, actor };
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("HeroData.recordMomentOfFulfillment", () => {
	it("appends a blank MoF entry without touching promise when below 5", async () => {
		const { model, actor } = makeHero({
			mof: [{ name: "old", description: "" }],
			promise: 3,
			pendingPromise: 2,
		});
		const result = await model.recordMomentOfFulfillment();

		expect(result).toBeNull();
		expect(actor.update).toHaveBeenCalledWith({
			"system.mof": [
				{ name: "old", description: "" },
				{ name: "", description: "" },
			],
		});
		expect(Hooks.callAll).not.toHaveBeenCalled();
	});

	it("resets a full track and applies banked promise, clamped to 5", async () => {
		const { model, actor } = makeHero({ promise: 5, pendingPromise: 3 });
		const result = await model.recordMomentOfFulfillment();

		expect(result).toBeNull();
		expect(actor.update).toHaveBeenCalledWith({
			"system.mof": [{ name: "", description: "" }],
			"system.promise": 3,
			"system.pendingPromise": 0,
		});
		expect(Hooks.callAll).not.toHaveBeenCalled();
	});

	it("fires litm.trackCompleted when applied pending fills another track (cascading MoF)", async () => {
		const { model, actor } = makeHero({ promise: 5, pendingPromise: 7 });
		const result = await model.recordMomentOfFulfillment();

		expect(actor.update).toHaveBeenCalledWith({
			"system.mof": [{ name: "", description: "" }],
			"system.promise": 5,
			"system.pendingPromise": 2,
		});
		expect(result).toMatchObject({ type: "promise" });
		expect(Hooks.callAll).toHaveBeenCalledWith("litm.trackCompleted", {
			actor,
			trackInfo: expect.objectContaining({ type: "promise" }),
		});
	});

	it("resets to zero when nothing is banked", async () => {
		const { model, actor } = makeHero({ promise: 5, pendingPromise: 0 });
		await model.recordMomentOfFulfillment();

		expect(actor.update).toHaveBeenCalledWith({
			"system.mof": [{ name: "", description: "" }],
			"system.promise": 0,
			"system.pendingPromise": 0,
		});
		expect(Hooks.callAll).not.toHaveBeenCalled();
	});
});
