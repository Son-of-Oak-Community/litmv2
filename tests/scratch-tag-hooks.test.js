import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ScratchableMixin,
	scratchOnce,
	scratchTag,
} from "../modules/active-effects/scratchable-mixin.js";

// `litm.preTagScratched` and `litm.tagScratched` are public hooks: a module
// may veto a scratch by returning false from the first, and reads the second
// to react to one. Both scratch entries have to honour that contract.

const Scratchable = ScratchableMixin(class {});

const effect = (isScratched = false, parent = {}) => {
	const system = new Scratchable();
	system.isScratched = isScratched;
	system.parent = { update: vi.fn(async () => {}) };
	return { system, parent };
};
const written = (fx) =>
	fx.system.parent.update.mock.calls.map(([data]) => data);

const actor = { id: "hero" };

beforeEach(() => {
	Hooks.call.mockClear();
	Hooks.callAll.mockClear();
});
afterEach(() => {
	Hooks.call.mockReset();
	Hooks.call.mockImplementation(() => true);
});

describe("ScratchableMixin#setScratched", () => {
	it("writes the state it is asked for", async () => {
		const fx = effect(false);
		await fx.system.setScratched(true);
		expect(written(fx)).toEqual([{ "system.isScratched": true }]);
	});

	it("writes nothing when the tag is already there", async () => {
		const scratched = effect(true);
		await scratched.system.setScratched(true);
		expect(written(scratched)).toEqual([]);

		const fresh = effect(false);
		await fresh.system.setScratched(false);
		expect(written(fresh)).toEqual([]);
	});
});

describe("scratchTag", () => {
	it("asks first, toggles, then announces it", async () => {
		const fx = effect(false);
		await expect(scratchTag(actor, fx)).resolves.toBe(true);
		expect(Hooks.call).toHaveBeenCalledWith("litm.preTagScratched", actor, fx);
		expect(written(fx)).toEqual([{ "system.isScratched": true }]);
		expect(Hooks.callAll).toHaveBeenCalledWith("litm.tagScratched", actor, fx);
	});

	it("unscratches a scratched tag through the same hooks", async () => {
		const fx = effect(true);
		await scratchTag(actor, fx);
		expect(written(fx)).toEqual([{ "system.isScratched": false }]);
		expect(Hooks.callAll).toHaveBeenCalledWith("litm.tagScratched", actor, fx);
	});

	it("does nothing when a module vetoes it", async () => {
		Hooks.call.mockImplementation(() => false);
		const fx = effect(false);
		await expect(scratchTag(actor, fx)).resolves.toBe(false);
		expect(written(fx)).toEqual([]);
		expect(Hooks.callAll).not.toHaveBeenCalled();
	});
});

describe("scratchOnce", () => {
	it("scratches a tag on a theme and names the theme's owner", async () => {
		const owner = { id: "hero" };
		const fx = effect(false, { documentName: "Item", parent: owner });
		await scratchOnce(fx);
		expect(Hooks.call).toHaveBeenCalledWith("litm.preTagScratched", owner, fx);
		expect(written(fx)).toEqual([{ "system.isScratched": true }]);
		expect(Hooks.callAll).toHaveBeenCalledWith("litm.tagScratched", owner, fx);
	});

	it("names the actor itself for a tag that lives on one", async () => {
		const owner = { documentName: "Actor", id: "challenge" };
		const fx = effect(false, owner);
		await scratchOnce(fx);
		expect(Hooks.callAll).toHaveBeenCalledWith("litm.tagScratched", owner, fx);
	});

	it("never un-scratches: a second run changes and announces nothing", async () => {
		const fx = effect(true);
		await scratchOnce(fx);
		expect(written(fx)).toEqual([]);
		expect(Hooks.call).not.toHaveBeenCalled();
		expect(Hooks.callAll).not.toHaveBeenCalled();
	});

	it("does nothing when a module vetoes it", async () => {
		Hooks.call.mockImplementation(() => false);
		const fx = effect(false);
		await scratchOnce(fx);
		expect(written(fx)).toEqual([]);
		expect(Hooks.callAll).not.toHaveBeenCalled();
	});
});
