import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	advanceFlagLimit,
	advanceSystemLimit,
} from "../modules/actor/mixins/actor-limits.js";
import { EffectTagsMixin } from "../modules/actor/mixins/effect-tags-mixin.js";
import { LimitsMixin } from "../modules/actor/mixins/limits-mixin.js";
import { registerActorHooks } from "../modules/system/hooks/actor-hooks.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";

// `litm.limitReached` is documented as "a status reaches a limit's max". It
// used to fire only from the story-tag sidebar, so every other write (Spend
// Power Inflict, chat actions, the token HUD, sheets) left `limit.value` stale
// and the GM's whisper never posted. It now fires from the limits layer, on the
// transition into reached only, and one choke point keeps stored values fresh.

const ME = "user-me";
const OTHER = "user-other";

const tiers = (n) => Array.from({ length: 6 }, (_, i) => i + 1 === n);

const reachedCalls = () =>
	Hooks.callAll.mock.calls.filter(([name]) => name === "litm.limitReached");

const limit = (overrides = {}) => ({
	id: "lim-1",
	label: "Wounded",
	outcome: "Overcome",
	max: 3,
	value: 0,
	...overrides,
});

const status = (n, limitId = "lim-1") =>
	fakeEffect({ type: "status_tag", system: { limitId, tiers: tiers(n) } });

// A flag-backed (journey-style) limits model on a fake actor. `stored` is what
// a real setFlag would have persisted, so later recalcs read the earlier write.
const Model = LimitsMixin(
	EffectTagsMixin(
		class {
			prepareDerivedData() {}
		},
	),
);

function buildActor({ limits = [limit()], effects = [], max } = {}) {
	const actor = fakeActor({ type: "journey", effects });
	actor.documentName = "Actor";
	actor.stored = limits;
	actor.getFlag = vi.fn(() => actor.stored);
	actor.setFlag = vi.fn(async (_scope, _key, value) => {
		await Promise.resolve();
		actor.stored = value;
		return actor;
	});
	const model = new Model();
	model.parent = actor;
	if (max !== undefined) model.getEffectiveMax = () => max;
	actor.system = model;
	return { actor, model };
}

beforeEach(() => {
	Hooks.on.mockClear();
	Hooks.callAll.mockClear();
	game.userId = ME;
});

describe("recalculateLimitValues: transition into reached", () => {
	it("fires once, with the effective max, when a status crosses the limit", async () => {
		const { actor, model } = buildActor({ effects: [status(3)] });

		const result = await model.recalculateLimitValues();

		expect(reachedCalls()).toHaveLength(1);
		const [, payload] = reachedCalls()[0];
		expect(payload.actor).toBe(actor);
		expect(payload.limit).toMatchObject({
			id: "lim-1",
			label: "Wounded",
			outcome: "Overcome",
			value: 3,
			max: 3,
		});
		expect(result.reached).toHaveLength(1);
	});

	it("reports the effective max, not the stored one", async () => {
		const { model } = buildActor({
			limits: [limit({ max: 99 })],
			effects: [status(5)],
			max: 5,
		});

		await model.recalculateLimitValues();

		expect(reachedCalls()[0][1].limit.max).toBe(5);
	});

	it("does not fire below the max", async () => {
		const { model } = buildActor({ effects: [status(2)] });
		await model.recalculateLimitValues();
		expect(reachedCalls()).toHaveLength(0);
	});

	it("does not fire again on later writes once the limit is reached", async () => {
		const { actor, model } = buildActor({ effects: [status(3)] });
		await model.recalculateLimitValues();

		// Another status lands on the same limit, then a plain re-recalc.
		actor.effects.push(status(1));
		actor.effects.at(-1).parent = actor;
		await model.recalculateLimitValues();
		await model.recalculateLimitValues();

		expect(reachedCalls()).toHaveLength(1);
	});

	it("does not fire when the stored value was already at the max", async () => {
		const { model } = buildActor({
			limits: [limit({ value: 3 })],
			effects: [status(3)],
		});
		await model.recalculateLimitValues();
		expect(reachedCalls()).toHaveLength(0);
	});

	it("fires again when the limit drops below the max and is reached anew", async () => {
		const { actor, model } = buildActor({ effects: [status(3)] });
		await model.recalculateLimitValues();

		actor.effects.length = 0;
		await model.recalculateLimitValues();
		expect(actor.stored[0].value).toBe(0);
		expect(reachedCalls()).toHaveLength(1);

		actor.effects.push(status(3));
		await model.recalculateLimitValues();
		expect(reachedCalls()).toHaveLength(2);
	});

	it("never fires for a limit with no maximum (immunity)", async () => {
		const { model } = buildActor({
			limits: [limit({ max: 0 })],
			effects: [status(6)],
		});
		await model.recalculateLimitValues();
		expect(reachedCalls()).toHaveLength(0);
	});

	it("fires once when concurrent recalcs race over the same crossing", async () => {
		// A status write recalcs from the ActiveEffect hook while the story-tag
		// sidebar awaits its own recalc for the same write. Both would read the
		// same stale stored value; the second must see the first's result.
		const { model } = buildActor({ effects: [status(3)] });

		await Promise.all([
			model.recalculateLimitValues(),
			model.recalculateLimitValues(),
			model.recalculateLimitValues(),
		]);

		expect(reachedCalls()).toHaveLength(1);
	});

	it("skips the write when no limit value changed", async () => {
		const { actor, model } = buildActor({
			limits: [limit({ value: 2 })],
			effects: [status(2)],
		});
		await model.recalculateLimitValues();
		expect(actor.setFlag).not.toHaveBeenCalled();
	});

	it("does nothing for a non-owner", async () => {
		const { actor, model } = buildActor({ effects: [status(3)] });
		actor.isOwner = false;
		const result = await model.recalculateLimitValues();
		expect(result).toEqual({ reached: [] });
		expect(actor.setFlag).not.toHaveBeenCalled();
		expect(reachedCalls()).toHaveLength(0);
	});
});

describe("advancing a limit directly (Spend Power process verbs)", () => {
	const flagActor = (value, max = 3) => {
		const actor = fakeActor({ type: "journey" });
		actor.getFlag = vi.fn(() => [limit({ value, max })]);
		actor.setFlag = vi.fn().mockResolvedValue(undefined);
		return actor;
	};

	it("fires when Advance carries a flag-backed limit to its max", async () => {
		const actor = flagActor(1);
		await advanceFlagLimit(actor, "lim-1", 2);
		expect(reachedCalls()).toHaveLength(1);
		const [, payload] = reachedCalls()[0];
		expect(payload.actor).toBe(actor);
		expect(payload.limit).toMatchObject({ id: "lim-1", value: 3, max: 3 });
	});

	it("fires for a challenge's system limits too", async () => {
		const actor = fakeActor({ type: "challenge" });
		actor.system = { _source: { limits: [limit({ value: 2 })] } };
		await advanceSystemLimit(actor, "lim-1", 1);
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(reachedCalls()).toHaveLength(1);
	});

	it("does not fire short of the max, when already there, or on Set Back", async () => {
		await advanceFlagLimit(flagActor(0), "lim-1", 2);
		await advanceFlagLimit(flagActor(3), "lim-1", 1);
		await advanceFlagLimit(flagActor(3), "lim-1", -1);
		expect(reachedCalls()).toHaveLength(0);
	});

	it("does not fire for an immune limit", async () => {
		await advanceFlagLimit(flagActor(0, 0), "lim-1", 1);
		expect(reachedCalls()).toHaveLength(0);
	});
});

describe("status writes recalc through one ActiveEffect choke point", () => {
	const handlers = (name) =>
		Hooks.on.mock.calls.filter(([hook]) => hook === name).map(([, fn]) => fn);
	const dispatch = (name, ...args) => {
		for (const fn of handlers(name)) fn(...args);
	};

	beforeEach(() => {
		registerActorHooks();
	});

	const withSpy = (actor) => {
		actor.documentName = "Actor";
		actor.system = { recalculateLimitValues: vi.fn().mockResolvedValue({}) };
		return actor;
	};

	it("recalcs after a linked status is created, by the user who created it", () => {
		const actor = withSpy(fakeActor({ type: "challenge" }));
		const effect = fakeEffect({
			type: "status_tag",
			system: { limitId: "lim-1", tiers: tiers(1) },
			parent: actor,
		});
		dispatch("createActiveEffect", effect, {}, ME);
		expect(actor.system.recalculateLimitValues).toHaveBeenCalledTimes(1);
	});

	it("does nothing on other clients", () => {
		const actor = withSpy(fakeActor({ type: "challenge" }));
		const effect = fakeEffect({
			type: "status_tag",
			system: { limitId: "lim-1", tiers: tiers(1) },
			parent: actor,
		});
		dispatch("createActiveEffect", effect, {}, OTHER);
		dispatch(
			"updateActiveEffect",
			effect,
			{ system: { tiers: [] } },
			{},
			OTHER,
		);
		dispatch("deleteActiveEffect", effect, {}, OTHER);
		expect(actor.system.recalculateLimitValues).not.toHaveBeenCalled();
	});

	it("ignores statuses with no limit, and tags that are not statuses", () => {
		const actor = withSpy(fakeActor({ type: "challenge" }));
		dispatch(
			"createActiveEffect",
			fakeEffect({
				type: "status_tag",
				system: { limitId: null, tiers: tiers(1) },
				parent: actor,
			}),
			{},
			ME,
		);
		dispatch(
			"createActiveEffect",
			fakeEffect({
				type: "story_tag",
				system: { limitId: "lim-1" },
				parent: actor,
			}),
			{},
			ME,
		);
		expect(actor.system.recalculateLimitValues).not.toHaveBeenCalled();
	});

	it("recalcs when tiers change, or a status is linked or unlinked, not on a rename", () => {
		const actor = withSpy(fakeActor({ type: "challenge" }));
		const linked = fakeEffect({
			type: "status_tag",
			system: { limitId: "lim-1", tiers: tiers(2) },
			parent: actor,
		});
		const unlinked = fakeEffect({
			type: "status_tag",
			system: { limitId: null, tiers: tiers(2) },
			parent: actor,
		});

		dispatch(
			"updateActiveEffect",
			linked,
			{ system: { tiers: tiers(2) } },
			{},
			ME,
		);
		expect(actor.system.recalculateLimitValues).toHaveBeenCalledTimes(1);

		// Unlinking: the effect no longer carries a limitId, the change does.
		dispatch(
			"updateActiveEffect",
			unlinked,
			{ system: { limitId: null } },
			{},
			ME,
		);
		expect(actor.system.recalculateLimitValues).toHaveBeenCalledTimes(2);

		dispatch("updateActiveEffect", linked, { name: "Renamed" }, {}, ME);
		expect(actor.system.recalculateLimitValues).toHaveBeenCalledTimes(2);
	});

	it("recalcs after a linked status is deleted so the stored value does not stay at max", () => {
		const actor = withSpy(fakeActor({ type: "challenge" }));
		const effect = fakeEffect({
			type: "status_tag",
			system: { limitId: "lim-1", tiers: tiers(3) },
			parent: actor,
		});
		dispatch("deleteActiveEffect", effect, {}, ME);
		expect(actor.system.recalculateLimitValues).toHaveBeenCalledTimes(1);
	});

	it("finds the actor when the status lives on one of its items", () => {
		const actor = withSpy(fakeActor({ type: "hero" }));
		actor.documentName = "Actor";
		const item = { documentName: "Item", parent: actor };
		const effect = fakeEffect({
			type: "status_tag",
			system: { limitId: "lim-1", tiers: tiers(1) },
			parent: item,
		});
		dispatch("createActiveEffect", effect, {}, ME);
		expect(actor.system.recalculateLimitValues).toHaveBeenCalledTimes(1);
	});

	it("skips compendium actors", () => {
		const actor = withSpy(fakeActor({ type: "challenge" }));
		actor.pack = "world.packs";
		const effect = fakeEffect({
			type: "status_tag",
			system: { limitId: "lim-1", tiers: tiers(1) },
			parent: actor,
		});
		dispatch("createActiveEffect", effect, {}, ME);
		expect(actor.system.recalculateLimitValues).not.toHaveBeenCalled();
	});

	it("addStatus reaching the max whispers once, even with the sidebar recalc racing", async () => {
		const { actor, model } = buildActor({ limits: [limit({ max: 3 })] });
		// Stand in for Foundry: creating an effect adds it to the actor, then
		// dispatches createActiveEffect to the changer's own client.
		actor.createEmbeddedDocuments = vi.fn(async (_type, data) => {
			const created = data.map((d) => ({
				...d,
				id: `fx-${actor.effects.length}`,
				parent: actor,
			}));
			actor.effects.push(...created);
			for (const effect of created) {
				dispatch("createActiveEffect", effect, {}, ME);
			}
			return created;
		});

		const added = model.addStatus("Wounded", { tier: 3, limitId: "lim-1" });
		// The sidebar's own recalc for the same write, started before the
		// hook's has finished writing.
		await Promise.all([added, model.recalculateLimitValues()]);

		expect(reachedCalls()).toHaveLength(1);
		expect(actor.stored[0].value).toBe(3);
	});

	it("addStatus onto a same-named unlinked status links it, moves the limit and whispers once", async () => {
		// The target already carries "Wounded" with no limit. Inflicting it again
		// through a limit group stacks the existing status; the link must land
		// with the stack, or the limit never moves.
		const existing = fakeEffect({
			id: "fx-wounded",
			type: "status_tag",
			name: "Wounded",
			system: {
				limitId: null,
				tiers: tiers(2),
				calculateMark: () => tiers(3),
			},
		});
		const { actor, model } = buildActor({
			limits: [limit({ max: 3 })],
			effects: [existing],
		});
		// Stand in for Foundry: apply the dotted keys, then dispatch
		// updateActiveEffect with the expanded diff to the changer's own client.
		actor.updateEmbeddedDocuments = vi.fn(async (_type, updates) => {
			for (const { _id, ...changes } of updates) {
				const effect = actor.effects.find((e) => e.id === _id);
				const diff = {};
				for (const [key, value] of Object.entries(changes)) {
					const field = key.replace(/^system\./, "");
					effect.system[field] = value;
					diff[field] = value;
				}
				dispatch("updateActiveEffect", effect, { system: diff }, {}, ME);
			}
			return [];
		});

		await model.addStatus("Wounded", { tier: 3, limitId: "lim-1" });
		// The sidebar's own recalc for the same write; it queues behind the hook's.
		await model.recalculateLimitValues();

		expect(existing.system.limitId).toBe("lim-1");
		expect(actor.stored[0].value).toBe(3);
		expect(reachedCalls()).toHaveLength(1);
	});
});
