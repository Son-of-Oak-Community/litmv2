import { describe, expect, it } from "vitest";
import { LitmActor } from "../modules/actor/litm-actor.js";

// Builds an effect shaped like the bits allApplicableEffects cares about.
const effect = (id, parentType) => {
	const e = { id, transfer: true, parent: null };
	e.parent = { type: parentType };
	return e;
};

const item = (type, effects) => {
	for (const e of effects) e.parent = { type };
	return { type, effects };
};

describe("LitmActor#allApplicableEffects", () => {
	it("excludes effects owned by vignette items", () => {
		const own = effect("own", "challenge");
		const addonTag = effect("addon", "addon");
		const vignetteTag = effect("vig", "vignette");

		const actor = new LitmActor({
			type: "challenge",
			effects: [own],
			items: [item("addon", [addonTag]), item("vignette", [vignetteTag])],
		});

		const ids = [...actor.allApplicableEffects()].map((e) => e.id);
		expect(ids).toEqual(["own", "addon"]);
		expect(ids).not.toContain("vig");
	});

	it("keeps every applicable effect when no vignettes are present", () => {
		const own = effect("own", "journey");
		const themeTag = effect("theme", "theme");

		const actor = new LitmActor({
			type: "journey",
			effects: [own],
			items: [item("theme", [themeTag])],
		});

		expect([...actor.allApplicableEffects()].map((e) => e.id)).toEqual([
			"own",
			"theme",
		]);
	});
});
