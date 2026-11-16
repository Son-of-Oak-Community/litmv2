import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyOperations,
	buildOperations,
	trackMax,
} from "../modules/apps/camping/camping-apply.js";
import {
	defaultCampingState,
	setActivity,
	setBackpackKept,
	setReflectTarget,
	setRestChoice,
	setSojournDuration,
	setType,
	sojournPowerBonus,
} from "../modules/apps/camping/camping-state.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

// camping-apply.test.js pins the plan `buildOperations` makes. These pin the
// other half: what `applyOperations` writes for that plan at Pack Up, which
// document it writes to, and when it deletes rather than updates.

beforeAll(() => {
	globalThis.CONFIG ??= {};
	globalThis.CONFIG.litmv2 ??= {};
	globalThis.CONFIG.litmv2.tagStringRe =
		/\[([^[\]!:-]+)(!)?(?:([-:])(\d+)?)?\]/g;
});

beforeEach(() => {
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
	Hooks.callAll.mockClear();
});

const world = ({ heroes = [], fellowshipActor = null } = {}) => ({
	heroes,
	sceneEffects: [],
	fellowshipActor,
	threatItems: [],
});

/** A status whose tier track reduces the way StatusTagData's does. */
function status(name, tier) {
	const tiers = Array.from({ length: 6 }, (_, i) => i + 1 === tier);
	return fakeEffect({
		name,
		type: "status_tag",
		system: {
			currentTier: tier,
			tiers,
			calculateReduction: (amount) =>
				Array.from({ length: 6 }, (_, i) => i + 1 === tier - amount),
		},
	});
}

/** Rest in the first period with `choices`: `[effect, choice]` pairs. */
function restPlan(hero, choices) {
	const state = defaultCampingState();
	setActivity(state, hero.id, 0, "rest");
	for (const [effect, choice] of choices) {
		setRestChoice(state, hero.id, 0, effect.id, choice);
	}
	return buildOperations(state, world({ heroes: [hero] })).operations;
}

describe("applyOperations — Rest on statuses", () => {
	it("writes the reduced tier track to the status's own parent", async () => {
		const tired = status("tired", 3);
		const hero = fakeActor({ effects: [tired] });

		await applyOperations(
			restPlan(hero, [[tired, { action: "reduce", amount: 2 }]]),
		);

		expect(hero.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
		expect(hero.updateEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			{
				_id: tired.id,
				"system.tiers": [true, false, false, false, false, false],
			},
		]);
		expect(hero.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("deletes a status reduced to nothing instead of leaving an empty track", async () => {
		const bruised = status("bruised", 2);
		const hero = fakeActor({ effects: [bruised] });

		await applyOperations(
			restPlan(hero, [[bruised, { action: "reduce", amount: 2 }]]),
		);

		expect(hero.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			bruised.id,
		]);
		expect(hero.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("deletes a status the hero chose to remove", async () => {
		const tired = status("tired", 3);
		const hero = fakeActor({ effects: [tired] });

		await applyOperations(restPlan(hero, [[tired, { action: "remove" }]]));

		expect(hero.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			tired.id,
		]);
		expect(hero.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("groups a hero's reductions into one update and its removals into one delete", async () => {
		const tired = status("tired", 3);
		const cold = status("cold", 4);
		const bruised = status("bruised", 2);
		const scared = status("scared", 1);
		const hero = fakeActor({ effects: [tired, cold, bruised, scared] });

		await applyOperations(
			restPlan(hero, [
				[tired, { action: "reduce", amount: 1 }],
				[cold, { action: "reduce", amount: 1 }],
				[bruised, { action: "remove" }],
				[scared, { action: "reduce", amount: 1 }],
			]),
		);

		expect(hero.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
		expect(
			hero.updateEmbeddedDocuments.mock.calls[0][1].map((u) => u._id),
		).toEqual([tired.id, cold.id]);
		expect(hero.deleteEmbeddedDocuments).toHaveBeenCalledTimes(1);
		expect(hero.deleteEmbeddedDocuments.mock.calls[0][1].sort()).toEqual(
			[bruised.id, scared.id].sort(),
		);
	});

	it("writes each hero's status to that hero", async () => {
		const tired = status("tired", 3);
		const cold = status("cold", 2);
		const heroA = fakeActor({ effects: [tired] });
		const heroB = fakeActor({ effects: [cold] });
		const state = defaultCampingState();
		setActivity(state, heroA.id, 0, "rest");
		setRestChoice(state, heroA.id, 0, tired.id, {
			action: "reduce",
			amount: 1,
		});
		setActivity(state, heroB.id, 0, "rest");
		setRestChoice(state, heroB.id, 0, cold.id, { action: "reduce", amount: 1 });
		const { operations } = buildOperations(
			state,
			world({ heroes: [heroA, heroB] }),
		);

		await applyOperations(operations);

		expect(heroA.updateEmbeddedDocuments.mock.calls[0][1][0]._id).toBe(
			tired.id,
		);
		expect(heroB.updateEmbeddedDocuments.mock.calls[0][1][0]._id).toBe(cold.id);
	});
});

describe("applyOperations — the backpack at Pack Up", () => {
	function heroWithBackpack(...effects) {
		const backpack = fakeItem({ type: "backpack", effects });
		const hero = fakeActor({ items: [backpack] });
		hero.system = { backpackItem: backpack };
		return { hero, backpack };
	}

	it("deactivates a tag the hero did not keep, on the backpack item", async () => {
		const rope = fakeEffect({ name: "rope", type: "story_tag", system: {} });
		const { hero, backpack } = heroWithBackpack(rope);
		const state = defaultCampingState();
		setBackpackKept(state, hero.id, rope.id, false);
		const { operations } = buildOperations(state, world({ heroes: [hero] }));
		expect(operations.disables).toContainEqual({ effect: rope });

		await applyOperations(operations);

		expect(backpack.updateEmbeddedDocuments).toHaveBeenCalledWith(
			"ActiveEffect",
			[{ _id: rope.id, disabled: true }],
		);
		expect(hero.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("brings a deactivated tag the hero kept back into use", async () => {
		const lamp = fakeEffect({
			name: "lamp",
			type: "story_tag",
			disabled: true,
			system: {},
		});
		const { hero, backpack } = heroWithBackpack(lamp);
		const state = defaultCampingState();
		setBackpackKept(state, hero.id, lamp.id, true);
		const { operations } = buildOperations(state, world({ heroes: [hero] }));

		await applyOperations(operations);

		expect(backpack.updateEmbeddedDocuments).toHaveBeenCalledWith(
			"ActiveEffect",
			[{ _id: lamp.id, disabled: false }],
		);
	});
});

describe("applyOperations — a sojourn Reflect improvement on an ordinary theme", () => {
	function sojournReflect(improve) {
		const theme = fakeItem({ type: "theme", effects: [] });
		theme.system = { improve: { value: improve } };
		const hero = fakeActor({ items: [theme] });
		hero.system = { themes: [{ theme, tags: [] }] };
		const state = defaultCampingState();
		setType(state, "sojourn");
		setActivity(state, hero.id, 0, "reflect");
		setReflectTarget(state, hero.id, 0, theme.id);
		const { operations } = buildOperations(state, world({ heroes: [hero] }));
		return { theme, hero, operations };
	}

	const completed = () =>
		Hooks.callAll.mock.calls.filter(([name]) => name === "litm.trackCompleted");

	it("fills the Improve track and announces the completed track", async () => {
		const { theme, hero, operations } = sojournReflect(1);

		await applyOperations(operations);

		expect(theme.update).toHaveBeenCalledTimes(1);
		expect(theme.update).toHaveBeenCalledWith({
			"system.improve.value": trackMax("improve"),
		});
		expect(completed()).toHaveLength(1);
		expect(completed()[0][1]).toMatchObject({
			actor: hero,
			trackInfo: { type: "improve", themeId: theme.id },
		});
	});

	it("writes nothing to a track that is already full, and still announces it", async () => {
		const { theme, operations } = sojournReflect(trackMax("improve"));

		await applyOperations(operations);

		expect(theme.update).not.toHaveBeenCalled();
		expect(completed()).toHaveLength(1);
	});

	it("announces once per hero when two reflect on the Fellowship theme", async () => {
		const fwTheme = fakeItem({ type: "theme", effects: [] });
		fwTheme.system = { isFellowship: true, improve: { value: 0 } };
		const fellowshipActor = fakeActor({ type: "fellowship", items: [fwTheme] });
		const heroA = fakeActor();
		heroA.system = { themes: [], fellowshipActor };
		const heroB = fakeActor();
		heroB.system = { themes: [], fellowshipActor };
		const state = defaultCampingState();
		setType(state, "sojourn");
		for (const hero of [heroA, heroB]) {
			setActivity(state, hero.id, 0, "reflect");
			setReflectTarget(state, hero.id, 0, fwTheme.id);
		}
		const { operations } = buildOperations(
			state,
			world({ heroes: [heroA, heroB], fellowshipActor }),
		);

		await applyOperations(operations);

		expect(completed().map(([, payload]) => payload.actor)).toEqual([
			heroA,
			heroB,
		]);
	});
});

// Core Book p.181: a sojourn's camp actions gain Power by its length.
describe("sojournPowerBonus", () => {
	const sojourn = (duration) => {
		const state = defaultCampingState();
		setType(state, "sojourn");
		setSojournDuration(state, duration);
		return state;
	};

	it("is nothing for a camp, whatever duration the state still holds", () => {
		const state = sojourn("months");
		setType(state, "camp");
		expect(sojournPowerBonus(state)).toBe(0);
		expect(sojournPowerBonus(defaultCampingState())).toBe(0);
	});

	it.each([
		["days", 1],
		["weeks", 2],
		["months", 3],
	])("is %s -> +%i for a sojourn", (duration, bonus) => {
		expect(sojournPowerBonus(sojourn(duration))).toBe(bonus);
	});

	it("is nothing for a sojourn with no recognised duration", () => {
		const state = sojourn("days");
		state.sojournDuration = "aeons";
		expect(sojournPowerBonus(state)).toBe(0);
	});
});
