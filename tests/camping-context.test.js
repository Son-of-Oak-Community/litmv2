import { describe, expect, it } from "vitest";
import {
	buildSteps,
	partitionCampingEffects,
	stepIsComplete,
} from "../modules/apps/camping/camping-context.js";
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
