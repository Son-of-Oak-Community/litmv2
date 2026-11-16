import { beforeAll, describe, expect, it } from "vitest";
import { BackpackData } from "../modules/item/backpack/backpack-data.js";
import {
	buildBackpackTagEffects,
	buildThemeTagEffects,
	LitmItem,
} from "../modules/item/litm-item.js";
import { StoryThemeData } from "../modules/item/story-theme/story-theme-data.js";
import { ThemeData } from "../modules/item/theme/theme-data.js";

// Legacy items kept their tags as arrays on `system`. The schema prunes those
// arrays on load, so `LitmItem.migrateData` copies them to `flags.litmv2`
// first; the createItem hook, the import override and world migration 001
// turn the stash into ActiveEffects. Foundry runs the Document-level hook on
// the whole source before the system model's, and discards its return value,
// so every assertion is on the object that was passed in.

beforeAll(() => {
	// The stub Item has no migrateData of its own; Foundry's returns the source.
	foundry.documents.Item.migrateData = (source) => source;
});

const power = (name, extra = {}) => ({ name, isActive: true, ...extra });

describe("LitmItem.migrateData: legacy theme tags", () => {
	it("stashes a theme's tag arrays on the item's flags, in place", () => {
		const powerTags = [power("Sturdy")];
		const weaknessTags = [power("Stubborn", { isActive: false })];
		const source = { type: "theme", system: { powerTags, weaknessTags } };

		LitmItem.migrateData(source);

		expect(source.flags.litmv2.legacyTags).toEqual({
			powerTags,
			weaknessTags,
			isFellowship: false,
		});
	});

	it("records that the theme is the Fellowship's", () => {
		const source = {
			type: "theme",
			system: { powerTags: [power("Oath")], isFellowship: true },
		};

		LitmItem.migrateData(source);

		expect(source.flags.litmv2.legacyTags.isFellowship).toBe(true);
	});

	it("stashes a theme that only has weakness tags", () => {
		const source = {
			type: "theme",
			system: { weaknessTags: [power("Stubborn")] },
		};

		LitmItem.migrateData(source);

		expect(source.flags.litmv2.legacyTags).toMatchObject({
			powerTags: [],
			weaknessTags: [power("Stubborn")],
		});
	});

	it("reads a story theme's tags from the nested theme object", () => {
		const source = {
			type: "story_theme",
			system: {
				theme: {
					powerTags: [power("Blessed")],
					weaknessTags: [power("Hunted")],
				},
			},
		};

		LitmItem.migrateData(source);

		expect(source.flags.litmv2.legacyTags).toMatchObject({
			powerTags: [power("Blessed")],
			weaknessTags: [power("Hunted")],
		});
	});

	it("falls back to a story theme's top-level arrays", () => {
		const source = {
			type: "story_theme",
			system: { powerTags: [power("Blessed")] },
		};

		LitmItem.migrateData(source);

		expect(source.flags.litmv2.legacyTags.powerTags).toEqual([
			power("Blessed"),
		]);
	});

	it.each(["power_tag", "weakness_tag", "fellowship_tag"])(
		"leaves a theme that already has a %s effect alone",
		(type) => {
			const source = {
				type: "theme",
				system: { powerTags: [power("Sturdy")] },
				effects: [{ type }],
			};

			LitmItem.migrateData(source);

			expect(source).not.toHaveProperty("flags");
		},
	);

	it("still stashes when the only effect is not a theme tag", () => {
		const source = {
			type: "theme",
			system: { powerTags: [power("Sturdy")] },
			effects: [{ type: "story_tag" }],
		};

		LitmItem.migrateData(source);

		expect(source.flags.litmv2.legacyTags.powerTags).toHaveLength(1);
	});

	it.each([
		["empty tag arrays", { type: "theme", system: { powerTags: [] } }],
		["no tag arrays", { type: "theme", system: {} }],
		["no system data (an update diff)", { type: "theme" }],
		[
			"an item type that has no tags",
			{ type: "trope", system: { powerTags: [power("Sturdy")] } },
		],
	])("writes no flags for %s", (_label, source) => {
		LitmItem.migrateData(source);
		expect(source).not.toHaveProperty("flags");
	});

	it("keeps the flags that were already there", () => {
		const source = {
			type: "theme",
			flags: { litmv2: { other: 1 }, elsewhere: { a: 2 } },
			system: { powerTags: [power("Sturdy")] },
		};

		LitmItem.migrateData(source);

		expect(source.flags.litmv2.other).toBe(1);
		expect(source.flags.elsewhere).toEqual({ a: 2 });
		expect(source.flags.litmv2.legacyTags.powerTags).toHaveLength(1);
	});

	it("survives the theme model's own migrateData running afterwards", () => {
		const powerTags = [power("Sturdy")];
		const source = { type: "theme", system: { powerTags, weaknessTags: [] } };

		LitmItem.migrateData(source);
		ThemeData.migrateData(source.system);

		expect(source.flags.litmv2.legacyTags.powerTags).toEqual(powerTags);
		expect(source.system).not.toHaveProperty("powerTags");
		expect(source.system).not.toHaveProperty("weaknessTags");
	});

	it("survives the story theme model dropping the nested theme object", () => {
		const powerTags = [power("Blessed")];
		const source = { type: "story_theme", system: { theme: { powerTags } } };

		LitmItem.migrateData(source);
		StoryThemeData.migrateData(source.system);

		expect(source.flags.litmv2.legacyTags.powerTags).toEqual(powerTags);
		expect(source.system).not.toHaveProperty("theme");
	});
});

describe("LitmItem.migrateData: legacy backpack contents", () => {
	const contents = () => [{ name: "Rope", isActive: true }];

	it("stashes the contents on the item's flags", () => {
		const source = { type: "backpack", system: { contents: contents() } };

		LitmItem.migrateData(source);

		expect(source.flags.litmv2.legacyContents).toEqual(contents());
	});

	it("leaves a backpack that already has a story tag alone", () => {
		const source = {
			type: "backpack",
			system: { contents: contents() },
			effects: [{ type: "story_tag" }],
		};

		LitmItem.migrateData(source);

		expect(source).not.toHaveProperty("flags");
	});

	it("still stashes when the only effect is not a story tag", () => {
		const source = {
			type: "backpack",
			system: { contents: contents() },
			effects: [{ type: "status_tag" }],
		};

		LitmItem.migrateData(source);

		expect(source.flags.litmv2.legacyContents).toHaveLength(1);
	});

	it.each([
		["empty contents", { type: "backpack", system: { contents: [] } }],
		[
			"contents that are not a list",
			{ type: "backpack", system: { contents: {} } },
		],
		["no contents", { type: "backpack", system: {} }],
	])("writes no flags for %s", (_label, source) => {
		LitmItem.migrateData(source);
		expect(source).not.toHaveProperty("flags");
	});

	it("survives the backpack model's own migrateData running afterwards", () => {
		const source = { type: "backpack", system: { contents: contents() } };

		LitmItem.migrateData(source);
		BackpackData.migrateData(source.system);

		expect(source.flags.litmv2.legacyContents).toEqual(contents());
		expect(source.system).not.toHaveProperty("contents");
	});
});

describe("LitmItem.migrateData: title tags", () => {
	it("moves a title tag flag onto the effect's system data", () => {
		const effect = {
			type: "power_tag",
			flags: { litmv2: { isTitleTag: true } },
		};
		const source = { type: "theme", system: {}, effects: [effect] };

		LitmItem.migrateData(source);

		expect(effect.system.isTitleTag).toBe(true);
		expect(effect.flags.litmv2).not.toHaveProperty("isTitleTag");
	});

	it("leaves an effect that carries no title tag flag alone", () => {
		const effect = { type: "power_tag", system: { question: "1" } };
		const source = { type: "theme", system: {}, effects: [effect] };

		LitmItem.migrateData(source);

		expect(effect).toEqual({ type: "power_tag", system: { question: "1" } });
	});

	// A power_tag can be burned for +3; a Fellowship theme's tags are
	// single-use and never burn, its title tag included.
	it("turns a Fellowship theme's power_tag title tag into a fellowship_tag", () => {
		const title = { type: "power_tag", system: { isTitleTag: true } };
		const other = { type: "power_tag", system: {} };
		const source = {
			type: "theme",
			system: { isFellowship: true },
			effects: [title, other],
		};

		LitmItem.migrateData(source);

		expect(title.type).toBe("fellowship_tag");
		expect(other.type).toBe("power_tag");
	});

	it("coerces a Fellowship title tag that was still marked by its flag", () => {
		const title = {
			type: "power_tag",
			flags: { litmv2: { isTitleTag: true } },
		};
		const source = {
			type: "theme",
			system: { isFellowship: true },
			effects: [title],
		};

		LitmItem.migrateData(source);

		expect(title.type).toBe("fellowship_tag");
	});

	it("keeps a Hero theme's title tag a power_tag", () => {
		const title = { type: "power_tag", system: { isTitleTag: true } };
		const source = {
			type: "theme",
			system: { isFellowship: false },
			effects: [title],
		};

		LitmItem.migrateData(source);

		expect(title.type).toBe("power_tag");
	});

	it("returns the source it was given", () => {
		const source = { type: "theme", system: {} };
		expect(LitmItem.migrateData(source)).toBe(source);
	});
});

// The stash is only names until these turn it into effect data. A legacy tag
// that was not active is a tag the Hero has not gained: it comes over disabled.
describe("buildThemeTagEffects", () => {
	const legacy = {
		powerTags: [
			{ name: "Sturdy", isActive: true, question: "2", isScratched: true },
			{ name: "Keen" },
		],
		weaknessTags: [{ name: "Stubborn", isActive: true, question: "1" }, {}],
	};

	it("maps power and weakness tags, then the title tag", () => {
		expect(
			buildThemeTagEffects(legacy, { name: "Warrior", isScratched: true }),
		).toEqual([
			{
				name: "Sturdy",
				type: "power_tag",
				disabled: false,
				system: { question: "2", isScratched: true },
			},
			{
				name: "Keen",
				type: "power_tag",
				disabled: true,
				system: { question: null, isScratched: false },
			},
			{
				name: "Stubborn",
				type: "weakness_tag",
				disabled: false,
				system: { question: "1" },
			},
			{
				name: "",
				type: "weakness_tag",
				disabled: true,
				system: { question: null },
			},
			{
				name: "Warrior",
				type: "power_tag",
				disabled: false,
				system: { question: "0", isScratched: true, isTitleTag: true },
			},
		]);
	});

	it("makes a Fellowship theme's power tags and title tag fellowship_tags", () => {
		const effects = buildThemeTagEffects(
			{ ...legacy, isFellowship: true },
			{ name: "Oath" },
		);

		expect(effects.map((e) => e.type)).toEqual([
			"fellowship_tag",
			"fellowship_tag",
			"weakness_tag",
			"weakness_tag",
			"fellowship_tag",
		]);
		expect(effects.at(-1).system).toEqual({
			question: "0",
			isScratched: false,
			isTitleTag: true,
		});
	});

	it("adds no title tag without a name", () => {
		expect(buildThemeTagEffects({ powerTags: [] })).toEqual([]);
		expect(buildThemeTagEffects({ powerTags: [] }, { name: "" })).toEqual([]);
	});
});

describe("buildBackpackTagEffects", () => {
	it("maps contents to story tags, active unless they say otherwise", () => {
		expect(
			buildBackpackTagEffects([
				{ name: "Rope" },
				{ name: "Lantern", isActive: false, isScratched: true },
				{ name: "Flask", isSingleUse: true },
				{},
			]),
		).toEqual([
			{
				name: "Rope",
				type: "story_tag",
				disabled: false,
				system: { isScratched: false, isSingleUse: false, isHidden: false },
			},
			{
				name: "Lantern",
				type: "story_tag",
				disabled: true,
				system: { isScratched: true, isSingleUse: false, isHidden: false },
			},
			{
				name: "Flask",
				type: "story_tag",
				disabled: false,
				system: { isScratched: false, isSingleUse: true, isHidden: false },
			},
			{
				name: "",
				type: "story_tag",
				disabled: false,
				system: { isScratched: false, isSingleUse: false, isHidden: false },
			},
		]);
	});
});
