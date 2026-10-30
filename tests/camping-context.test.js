import { afterEach, describe, expect, it } from "vitest";
import {
	buildContext,
	buildSteps,
	partitionCampingEffects,
	stepIsComplete,
} from "../modules/apps/camping/camping-context.js";
import {
	defaultCampingState,
	setActivity,
	setReflectAbandon,
	setReflectMilestone,
	setType,
} from "../modules/apps/camping/camping-state.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

// Minimal hero shape — just the fields buildSteps / stepIsComplete read.
function hero({
	thirdPeriodActive = false,
	activities = [],
	qualityTimeAction = "",
} = {}) {
	return {
		thirdPeriodActive,
		activities,
		qualityTime: { action: qualityTimeAction },
	};
}

function act(activity = null) {
	return { activity };
}

describe("partitionCampingEffects — Quality Time fellowship tags", () => {
	// Fellowship tags sit on the Fellowship actor's theme item. A hero reaches
	// them only through `system.fellowshipActor`.
	function fellowshipWith(...tags) {
		return fakeActor({
			type: "fellowship",
			items: [fakeItem({ type: "theme", effects: tags })],
		});
	}
	const scratchedTag = (name) =>
		fakeEffect({
			name,
			type: "fellowship_tag",
			system: { isScratched: true },
		});

	it("lists the scratched tags of the hero's Fellowship", () => {
		const spent = scratchedTag("we never give up");
		const fresh = fakeEffect({
			type: "fellowship_tag",
			system: { isScratched: false },
		});
		const hero = fakeActor();
		hero.system = { fellowshipActor: fellowshipWith(spent, fresh) };

		const { scratchedFellowshipTags } = partitionCampingEffects(hero);

		expect(scratchedFellowshipTags).toEqual([spent]);
	});

	it("does not list a fellowship_tag that sits on the hero rather than the Fellowship", () => {
		const stray = scratchedTag("stray");
		const hero = fakeActor({
			items: [fakeItem({ type: "theme", effects: [stray] })],
		});
		hero.system = { fellowshipActor: fellowshipWith() };

		expect(partitionCampingEffects(hero).scratchedFellowshipTags).toEqual([]);
	});

	it("lists an older Fellowship theme's scratched power_tag too", () => {
		const legacy = fakeEffect({
			name: "the cooking fire",
			type: "power_tag",
			system: { isScratched: true },
		});
		const theme = fakeItem({ type: "theme", effects: [legacy] });
		theme.documentName = "Item";
		legacy.parent = theme;
		const fellowship = fakeActor({ type: "fellowship", items: [theme] });
		const hero = fakeActor();
		hero.system = { fellowshipActor: fellowship };

		expect(partitionCampingEffects(hero).scratchedFellowshipTags).toEqual([
			legacy,
		]);
	});

	it("is empty when the hero has no Fellowship", () => {
		const hero = fakeActor();
		hero.system = { fellowshipActor: null };

		expect(partitionCampingEffects(hero).scratchedFellowshipTags).toEqual([]);
	});

	it("leaves the hero's own buckets alone", () => {
		const power = fakeEffect({
			type: "power_tag",
			system: { isScratched: true },
		});
		const rel = fakeEffect({ type: "relationship_tag" });
		const hero = fakeActor({ effects: [power, rel] });
		hero.system = { fellowshipActor: fellowshipWith(scratchedTag("x")) };

		const buckets = partitionCampingEffects(hero);

		expect(buckets.scratchedRecoverable).toEqual([power]);
		expect(buckets.relationshipEffects).toEqual([rel]);
	});

	it("skips a scratched power tag the hero hasn't gained (disabled)", () => {
		const locked = fakeEffect({
			type: "power_tag",
			disabled: true,
			system: { isScratched: true },
		});
		const hero = fakeActor({ effects: [locked] });
		hero.system = { fellowshipActor: null };

		expect(partitionCampingEffects(hero).scratchedRecoverable).toEqual([]);
	});
});

describe("buildSteps", () => {
	it("emits the 4-step timeline when no hero has opted into period 3", () => {
		const steps = buildSteps("period1", [hero()]);
		expect(steps.map((s) => s.id)).toEqual([
			"period1",
			"period2",
			"qualityTime",
			"packUp",
		]);
	});

	it("inserts period3 between period2 and qualityTime when any hero opts in", () => {
		const steps = buildSteps("period2", [
			hero({ thirdPeriodActive: false }),
			hero({ thirdPeriodActive: true }),
		]);
		expect(steps.map((s) => s.id)).toEqual([
			"period1",
			"period2",
			"period3",
			"qualityTime",
			"packUp",
		]);
	});

	it("marks the active step as current", () => {
		const steps = buildSteps("qualityTime", [hero()]);
		const current = steps.find((s) => s.isCurrent);
		expect(current.id).toBe("qualityTime");
		expect(current.cssClass).toContain("active");
	});

	it("a complete step that is not current gets the 'complete' class", () => {
		const steps = buildSteps("period2", [
			hero({ activities: [act("rest"), act("reflect")] }),
		]);
		const p1 = steps.find((s) => s.id === "period1");
		expect(p1.isComplete).toBe(true);
		expect(p1.cssClass).toContain("complete");
		expect(p1.cssClass).not.toContain("active");
	});

	it("the current step never gets 'complete' even when its heuristic passes", () => {
		const steps = buildSteps("period1", [hero({ activities: [act("rest")] })]);
		const p1 = steps.find((s) => s.id === "period1");
		expect(p1.isCurrent).toBe(true);
		expect(p1.cssClass).toBe("active");
	});
});

describe("stepIsComplete", () => {
	it("period1 needs every hero to have an activity in slot 0", () => {
		expect(
			stepIsComplete("period1", [
				hero({ activities: [act("rest")] }),
				hero({ activities: [act("campAction")] }),
			]),
		).toBe(true);
		expect(
			stepIsComplete("period1", [
				hero({ activities: [act("rest")] }),
				hero({ activities: [act(null)] }),
			]),
		).toBe(false);
	});

	it("period2 reads slot 1", () => {
		expect(
			stepIsComplete("period2", [
				hero({ activities: [act("rest"), act("reflect")] }),
			]),
		).toBe(true);
		expect(
			stepIsComplete("period2", [hero({ activities: [act("rest")] })]),
		).toBe(false);
	});

	it("period3 only considers opted-in heroes", () => {
		expect(
			stepIsComplete("period3", [
				hero({ thirdPeriodActive: false, activities: [act("rest")] }),
				hero({
					thirdPeriodActive: true,
					activities: [act("rest"), act("reflect"), act("campAction")],
				}),
			]),
		).toBe(true);
	});

	it("period3 is incomplete when an opted-in hero has no slot-2 activity", () => {
		expect(
			stepIsComplete("period3", [
				hero({
					thirdPeriodActive: true,
					activities: [act("rest"), act("reflect"), act(null)],
				}),
			]),
		).toBe(false);
	});

	it("period3 is incomplete when no hero opted in (no one to check)", () => {
		expect(
			stepIsComplete("period3", [hero({ thirdPeriodActive: false })]),
		).toBe(false);
	});

	it("qualityTime needs every hero to have an action picked", () => {
		expect(
			stepIsComplete("qualityTime", [
				hero({ qualityTimeAction: "recoverFellowship" }),
				hero({ qualityTimeAction: "rephraseRelationship" }),
			]),
		).toBe(true);
		expect(
			stepIsComplete("qualityTime", [
				hero({ qualityTimeAction: "recoverFellowship" }),
				hero({ qualityTimeAction: "" }),
			]),
		).toBe(false);
	});

	it("packUp is terminal — never complete", () => {
		expect(stepIsComplete("packUp", [hero()])).toBe(false);
	});

	it("returns false for an empty hero list", () => {
		expect(stepIsComplete("period1", [])).toBe(false);
	});
});

describe("buildContext — Reflect rows", () => {
	// Core Book p.181 puts the Quest marks (Abandon / Milestone) in the Reflect
	// activity's own text, so a camp and a sojourn offer the same selects. Only
	// the Improve reward differs, and that is decided at apply time.
	const original = {
		actors: globalThis.game.actors,
		packs: globalThis.game.packs,
		isGM: globalThis.game.user.isGM,
	};

	afterEach(() => {
		globalThis.game.actors = original.actors;
		globalThis.game.packs = original.packs;
		globalThis.game.user.isGM = original.isGM;
	});

	function reflectRow(type) {
		// Fixed ids so the camp and sojourn rows can be compared whole.
		const theme = fakeItem({ id: "theme-1", type: "theme", name: "Wanderer" });
		const actor = fakeActor({ type: "hero", id: "hero-1", items: [theme] });
		actor.system = { themes: [{ theme, tags: [] }], fellowshipActor: null };
		globalThis.game.actors = { filter: (fn) => [actor].filter(fn) };
		globalThis.game.packs = { get: () => undefined };
		globalThis.game.user.isGM = true;

		const state = defaultCampingState();
		setType(state, type);
		setActivity(state, actor.id, 0, "reflect");
		setReflectMilestone(state, actor.id, 0, theme.id);
		setReflectAbandon(state, actor.id, 0, theme.id);
		return buildContext(state).heroes[0].activities[0];
	}

	it("carries the chosen Milestone and Abandon themes on a camp", () => {
		const row = reflectRow("camp");

		expect(row.reflectMilestoneName).toBe("Wanderer");
		expect(row.reflectAbandonName).toBe("Wanderer");
	});

	it("builds the same row for a camp as for a sojourn", () => {
		expect(reflectRow("camp")).toEqual(reflectRow("sojourn"));
	});
});
