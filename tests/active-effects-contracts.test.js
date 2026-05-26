import { describe, expect, it } from "vitest";
import {
	FellowshipTagData,
	PowerTagData,
	RelationshipTagData,
	StatusTagData,
	StoryTagData,
	WeaknessTagData,
} from "../modules/active-effects/index.js";

// These getters drive sheet/UI dispatch: which polarity to pre-select, which
// states a tag is allowed to enter, whether the burn button is enabled.
// They're cheap to test and easy to regress, so we pin the contract here.

const make = (Cls, source = {}) => {
	const instance = Object.create(Cls.prototype);
	Object.assign(instance, source);
	return instance;
};

describe("PowerTagData contracts", () => {
	it("canBurn flips with isScratched", () => {
		expect(make(PowerTagData, { isScratched: false }).canBurn).toBe(true);
		expect(make(PowerTagData, { isScratched: true }).canBurn).toBe(false);
	});

	it("allowedStates (GM cycle) is positive → scratched → negative", () => {
		// Narrator override (Core Book p.76) places the negative flip last, so
		// the natural-polarity path (positive, then burn-via-scratch) is
		// reached first on the cycle.
		expect(make(PowerTagData).allowedStates).toBe(
			",positive,scratched,negative",
		);
	});

	it("playerAllowedStates restricts players to natural polarity", () => {
		expect(make(PowerTagData).playerAllowedStates).toBe(",positive,scratched");
	});

	it("defaultPolarity is +1", () => {
		expect(make(PowerTagData).defaultPolarity).toBe(1);
	});
});

describe("WeaknessTagData contracts", () => {
	it("never burns", () => {
		expect(make(WeaknessTagData).canBurn).toBe(false);
	});

	it("allowedStates (GM cycle) is negative → positive (no scratch)", () => {
		expect(make(WeaknessTagData).allowedStates).toBe(",negative,positive");
	});

	it("playerAllowedStates restricts players to negative only", () => {
		expect(make(WeaknessTagData).playerAllowedStates).toBe(",negative");
	});

	it("defaultPolarity is -1", () => {
		expect(make(WeaknessTagData).defaultPolarity).toBe(-1);
	});
});

describe("FellowshipTagData contracts", () => {
	it("isSingleUse is always true", () => {
		expect(make(FellowshipTagData).isSingleUse).toBe(true);
	});

	it("never burns (single-use override)", () => {
		expect(make(FellowshipTagData).canBurn).toBe(false);
	});

	it("only allows positive state", () => {
		expect(make(FellowshipTagData).allowedStates).toBe(",positive");
	});

	it("inherits +1 default polarity from PowerTagData", () => {
		expect(make(FellowshipTagData).defaultPolarity).toBe(1);
	});
});

describe("RelationshipTagData contracts", () => {
	it("isSingleUse is always true", () => {
		expect(make(RelationshipTagData).isSingleUse).toBe(true);
	});

	it("never burns", () => {
		expect(make(RelationshipTagData).canBurn).toBe(false);
	});

	it("allows positive and negative", () => {
		expect(make(RelationshipTagData).allowedStates).toBe(",positive,negative");
	});

	it("defaultPolarity is +1", () => {
		expect(make(RelationshipTagData).defaultPolarity).toBe(1);
	});
});

describe("StoryTagData contracts", () => {
	it("canBurn requires not-single-use AND not-scratched", () => {
		expect(
			make(StoryTagData, { isSingleUse: false, isScratched: false }).canBurn,
		).toBe(true);
		expect(
			make(StoryTagData, { isSingleUse: true, isScratched: false }).canBurn,
		).toBe(false);
		expect(
			make(StoryTagData, { isSingleUse: false, isScratched: true }).canBurn,
		).toBe(false);
	});

	it("allowedStates varies with isSingleUse", () => {
		expect(make(StoryTagData, { isSingleUse: false }).allowedStates).toBe(
			",positive,negative,scratched",
		);
		expect(make(StoryTagData, { isSingleUse: true }).allowedStates).toBe(
			",positive,negative",
		);
	});

	it("defaultPolarity is null (context-dependent)", () => {
		expect(make(StoryTagData).defaultPolarity).toBeNull();
	});
});

describe("StatusTagData contracts", () => {
	it("never burns", () => {
		expect(make(StatusTagData).canBurn).toBe(false);
	});

	it("allows positive and negative", () => {
		expect(make(StatusTagData).allowedStates).toBe(",positive,negative");
	});

	it("defaultPolarity is null (context-dependent)", () => {
		expect(make(StatusTagData).defaultPolarity).toBeNull();
	});
});
