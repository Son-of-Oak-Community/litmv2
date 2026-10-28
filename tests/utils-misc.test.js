import { describe, expect, it } from "vitest";
import { effectToPlain } from "../modules/active-effects/effect-queries.js";
import {
	availableThemebookImprovements,
	getDefaultItemIcon,
	keepUnrenderedArrayKeys,
	titleCase,
	toQuestionOptions,
} from "../modules/utils.js";
import { fakeEffect } from "./__helpers__/factories.js";

describe("titleCase", () => {
	it("capitalises each word", () => {
		expect(titleCase("hello world")).toBe("Hello World");
	});

	it("preserves common short connectors mid-string", () => {
		expect(titleCase("the king of the north")).toBe("The King of the North");
		expect(titleCase("blade and shield")).toBe("Blade and Shield");
	});

	it("always capitalises the leading word, even if it's a connector", () => {
		expect(titleCase("the road")).toBe("The Road");
	});
});

describe("toQuestionOptions", () => {
	it("returns letter labels keyed by stringified index", () => {
		expect(toQuestionOptions(["who?", "what?", "where?"])).toEqual({
			0: "A",
			1: "B",
			2: "C",
		});
	});

	it("skips empty / whitespace-only entries", () => {
		expect(toQuestionOptions(["a", "", "  ", "d"])).toEqual({ 0: "A", 3: "D" });
	});

	it("honours skipFirst", () => {
		expect(toQuestionOptions(["intro", "real q", "another"], 1)).toEqual({
			1: "B",
			2: "C",
		});
	});

	it("switches to numeric labels past index 25", () => {
		const arr = Array.from({ length: 28 }, (_, i) => `q${i}`);
		const opts = toQuestionOptions(arr);
		expect(opts[25]).toBe("Z");
		expect(opts[26]).toBe("27");
		expect(opts[27]).toBe("28");
	});

	it("returns an empty object for empty / nullish input", () => {
		expect(toQuestionOptions([])).toEqual({});
		expect(toQuestionOptions()).toEqual({});
	});
});

describe("availableThemebookImprovements", () => {
	it("drops entries already claimed by (name, description) match", () => {
		const claimed = [{ name: "Sharp Eyes", description: "+1 to spot" }];
		const entries = [
			{ name: "Sharp Eyes", description: "+1 to spot" },
			{ name: "Steady Hand", description: "+1 to aim" },
		];

		const remaining = availableThemebookImprovements(claimed, entries);
		expect(remaining.map((e) => e.name)).toEqual(["Steady Hand"]);
	});

	it("treats name-match-but-different-description as a different entry", () => {
		const claimed = [{ name: "Sharp Eyes", description: "old text" }];
		const entries = [{ name: "Sharp Eyes", description: "new text" }];

		expect(availableThemebookImprovements(claimed, entries)).toHaveLength(1);
	});

	it("skips entries with neither name nor description", () => {
		const entries = [
			{ name: "", description: "" },
			{ name: "Real", description: "" },
			{},
		];

		const remaining = availableThemebookImprovements([], entries);
		expect(remaining.map((e) => e.name)).toEqual(["Real"]);
	});

	it("preserves original index in returned entries", () => {
		const entries = [
			{ name: "", description: "" }, // skipped (empty)
			{ name: "A", description: "" },
			{ name: "", description: "" }, // skipped
			{ name: "B", description: "" },
		];

		const remaining = availableThemebookImprovements([], entries);
		expect(remaining.map((e) => e.index)).toEqual([1, 3]);
	});
});

describe("effectToPlain", () => {
	it("flattens an effect into a UI-friendly plain object", () => {
		const parent = { id: "theme-1", name: "Hunter" };
		const e = fakeEffect({ id: "e-1", name: "fierce", type: "power_tag" });
		e.parent = parent;
		e.active = true;

		expect(effectToPlain(e)).toEqual({
			_id: "e-1",
			id: "e-1",
			uuid: "Effect.e-1",
			name: "fierce",
			type: "power_tag",
			system: e.system,
			active: true,
			themeId: "theme-1",
			themeName: "Hunter",
		});
	});

	it("uses _id as id fallback when id is absent", () => {
		const e = { _id: "x", name: "n", type: "story_tag", system: {} };
		expect(effectToPlain(e).id).toBe("x");
	});
});

describe("getDefaultItemIcon", () => {
	it("returns the level-based icon for a theme", () => {
		expect(getDefaultItemIcon("theme", { level: "adventure" })).toBe(
			"systems/litmv2/assets/media/icons/adventure.svg",
		);
	});

	it("returns the themebook icon using system.theme_level", () => {
		expect(getDefaultItemIcon("themebook", { theme_level: "greatness" })).toBe(
			"systems/litmv2/assets/media/icons/greatness.svg",
		);
	});

	it("falls back to origin when no level is provided on a themebook", () => {
		expect(getDefaultItemIcon("themebook", {})).toBe(
			"systems/litmv2/assets/media/icons/origin.svg",
		);
	});

	it("returns the static map entry for known non-theme item types", () => {
		expect(getDefaultItemIcon("backpack")).toBe(
			"systems/litmv2/assets/media/icons/backpack.svg",
		);
		expect(getDefaultItemIcon("trope")).toBe("icons/svg/target.svg");
	});

	it("returns null for unknown item types", () => {
		expect(getDefaultItemIcon("unknown")).toBeNull();
	});
});

describe("keepUnrenderedArrayKeys", () => {
	const doc = {
		_source: {
			system: {
				limits: [
					{ id: "a", label: "harm", value: 3, advanced: 1, hidden: false },
					{ id: "b", label: "flee", value: 0, advanced: 0, hidden: true },
				],
			},
		},
	};

	it("fills unrendered keys from the stored entry, keeping submitted ones", () => {
		const data = {
			name: "Ogre",
			"system.limits.0.label": "hurt",
			"system.limits.1.label": "flee",
		};
		keepUnrenderedArrayKeys(data, doc, "system.limits");
		expect(data).toMatchObject({
			"system.limits.0.id": "a",
			"system.limits.0.label": "hurt",
			"system.limits.0.value": 3,
			"system.limits.0.advanced": 1,
			"system.limits.0.hidden": false,
			"system.limits.1.id": "b",
		});
	});

	it("leaves the data alone when the form does not render the array", () => {
		const data = { name: "Ogre" };
		keepUnrenderedArrayKeys(data, doc, "system.limits");
		expect(data).toEqual({ name: "Ogre" });
	});
});
