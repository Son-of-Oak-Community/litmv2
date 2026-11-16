import { describe, expect, it } from "vitest";
import {
	fellowshipTagEffect,
	powerTagEffect,
	relationshipTagEffect,
	statusTagEffect,
	storyTagEffect,
	weaknessTagEffect,
} from "../modules/active-effects/effect-factories.js";
import {
	findApplicableEffect,
	isEffectVisible,
	partitionEffects,
} from "../modules/active-effects/effect-queries.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

describe("partitionEffects", () => {
	it("groups applicable effects by type into requested buckets", () => {
		const theme = fakeItem({
			effects: [
				fakeEffect({ type: "power_tag", name: "fierce" }),
				fakeEffect({ type: "weakness_tag", name: "proud" }),
			],
		});
		const actor = fakeActor({
			effects: [
				fakeEffect({ type: "story_tag", name: "blessed" }),
				fakeEffect({ type: "status_tag", name: "tired" }),
			],
			items: [theme],
		});

		const { story_tag, status_tag, power_tag } = partitionEffects(
			actor,
			"story_tag",
			"status_tag",
			"power_tag",
		);

		expect(story_tag.map((e) => e.name)).toEqual(["blessed"]);
		expect(status_tag.map((e) => e.name)).toEqual(["tired"]);
		expect(power_tag.map((e) => e.name)).toEqual(["fierce"]);
	});

	it("skips effects whose type wasn't requested", () => {
		const actor = fakeActor({
			effects: [
				fakeEffect({ type: "story_tag" }),
				fakeEffect({ type: "weakness_tag" }),
			],
		});
		const buckets = partitionEffects(actor, "story_tag");
		expect(Object.keys(buckets)).toEqual(["story_tag"]);
		expect(buckets.story_tag).toHaveLength(1);
	});
});

describe("findApplicableEffect", () => {
	it("returns the first effect matching the predicate", () => {
		const target = fakeEffect({ type: "story_tag", name: "match" });
		const actor = fakeActor({
			effects: [fakeEffect({ type: "status_tag" }), target, fakeEffect()],
		});
		const found = findApplicableEffect(actor, (e) => e.name === "match");
		expect(found).toBe(target);
	});

	it("returns undefined when nothing matches", () => {
		const actor = fakeActor({ effects: [fakeEffect()] });
		expect(findApplicableEffect(actor, () => false)).toBeUndefined();
	});
});

describe("effect factories", () => {
	it("powerTagEffect: disabled when inactive, system carries question/scratch", () => {
		const data = powerTagEffect({
			name: "Sharp eyes",
			question: "?",
			isScratched: true,
		});
		expect(data).toMatchObject({
			name: "Sharp eyes",
			type: "power_tag",
			disabled: true,
			system: { question: "?", isScratched: true },
		});
	});

	it("weaknessTagEffect: defaults to disabled true (inactive)", () => {
		expect(weaknessTagEffect({ name: "Proud" }).disabled).toBe(true);
		expect(weaknessTagEffect({ name: "Proud", isActive: true }).disabled).toBe(
			false,
		);
	});

	it("fellowshipTagEffect: emits fellowship_tag type", () => {
		expect(fellowshipTagEffect({ name: "Trust" }).type).toBe("fellowship_tag");
	});

	it("relationshipTagEffect: carries targetId", () => {
		expect(
			relationshipTagEffect({ name: "Bond", targetId: "abc" }),
		).toMatchObject({
			type: "relationship_tag",
			system: { targetId: "abc" },
		});
	});

	it("storyTagEffect: defaults all flags to false, limitId null", () => {
		expect(storyTagEffect({ name: "Wind" }).system).toEqual({
			isScratched: false,
			isSingleUse: false,
			isHidden: false,
			limitId: null,
		});
	});

	it("statusTagEffect: defaults to a 6-element tier array of false", () => {
		const data = statusTagEffect({ name: "Tired" });
		expect(data.type).toBe("status_tag");
		expect(data.system.tiers).toEqual([
			false,
			false,
			false,
			false,
			false,
			false,
		]);
	});

	it("statusTagEffect: passes through a custom tier array", () => {
		const tiers = [false, false, true, false, false, false];
		expect(statusTagEffect({ name: "Tired", tiers }).system.tiers).toBe(tiers);
	});
});

describe("isEffectVisible", () => {
	it("returns true for a GM regardless of isHidden", () => {
		global.game = { user: { isGM: true } };
		expect(isEffectVisible({ system: { isHidden: true } })).toBe(true);
		expect(isEffectVisible({ system: { isHidden: false } })).toBe(true);
	});

	it("returns true for a non-GM when isHidden is false", () => {
		global.game = { user: { isGM: false } };
		expect(isEffectVisible({ system: { isHidden: false } })).toBe(true);
	});

	it("returns false for a non-GM when isHidden is true", () => {
		global.game = { user: { isGM: false } };
		expect(isEffectVisible({ system: { isHidden: true } })).toBe(false);
	});

	it("treats missing system as not hidden (defaults to visible)", () => {
		global.game = { user: { isGM: false } };
		expect(isEffectVisible({})).toBe(true);
		expect(isEffectVisible({ system: {} })).toBe(true);
	});
});
