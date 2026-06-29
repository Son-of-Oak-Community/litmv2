import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeroData } from "../modules/actor/hero/hero-data.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

// HeroData composes EffectTagsMixin + extends foundry.abstract.TypeDataModel.
// We use `new HeroData()` so private class brand and field initialisers fire
// (Object.create skips both, and the private #partitionAllEffects check trips).
// The stub base constructor only does Object.assign(this, source); the real
// schema isn't enforced here, so each test seeds whatever properties the
// getter under test actually reads.
const makeHero = ({
	items = [],
	effects = [],
	fellowshipId = "",
	fellowshipActor = null,
} = {}) => {
	const actor = fakeActor({ type: "hero", items, effects });
	const model = new HeroData();
	model.parent = actor;
	model.fellowshipId = fellowshipId;
	// limit is touched by prepareDerivedData; pre-seed so the call doesn't NPE
	model.limit = { value: 5, max: 5 };
	if (fellowshipActor) {
		actor.system.fellowshipActor = fellowshipActor;
		game.actors.get.mockReturnValue(fellowshipActor);
	}
	return { model, actor };
};

beforeEach(() => {
	vi.clearAllMocks();
	// Enable the fellowship path by default — useFellowship reads from settings.
	game.settings.get.mockImplementation((_ns, key) => {
		if (key === "use_fellowship") return true;
		if (key === "hero_limit") return 5;
		return undefined;
	});
});

describe("HeroData.themes", () => {
	it("includes own non-fellowship themes and story_themes, sorted by `sort`", () => {
		const themeA = fakeItem({
			type: "theme",
			name: "B-theme",
			effects: [fakeEffect({ type: "power_tag", name: "fierce" })],
		});
		themeA.sort = 200;
		themeA.system = { isFellowship: false };

		const themeB = fakeItem({
			type: "theme",
			name: "A-theme",
			effects: [
				fakeEffect({
					type: "power_tag",
					name: "title",
					system: { isTitleTag: true },
				}),
				fakeEffect({ type: "weakness_tag", name: "proud", system: {} }),
			],
		});
		themeB.sort = 100;
		themeB.system = { isFellowship: false };
		// Ensure non-title-tag has a system object too
		themeB.effects[0].system.isTitleTag = true;
		themeB.effects[1].system.isTitleTag = false;

		const { model } = makeHero({ items: [themeA, themeB] });

		const themes = model.themes;
		expect(themes.map((t) => t.theme.name)).toEqual(["A-theme", "B-theme"]);
		// Title tag sorts first within a theme's tag list
		expect(themes[0].tags.map((e) => e.name)).toEqual(["title", "proud"]);
	});

	it("collapses duplicate title tags to a single one (read-side guard)", () => {
		const theme = fakeItem({
			type: "theme",
			name: "Doubled",
			effects: [
				fakeEffect({
					type: "power_tag",
					name: "title",
					system: { isTitleTag: true },
				}),
				fakeEffect({
					type: "power_tag",
					name: "title-dupe",
					system: { isTitleTag: true },
				}),
				fakeEffect({ type: "power_tag", name: "fierce", system: {} }),
			],
		});
		theme.sort = 0;
		theme.system = { isFellowship: false };

		const { model } = makeHero({ items: [theme] });

		const tags = model.themes[0].tags;
		expect(tags.filter((e) => e.system.isTitleTag)).toHaveLength(1);
		expect(tags.map((e) => e.name)).toEqual(["title", "fierce"]);
	});

	it("excludes fellowship-flagged themes from the hero's own themes", () => {
		const own = fakeItem({ type: "theme", name: "mine" });
		own.sort = 0;
		own.system = { isFellowship: false };
		const fellowship = fakeItem({ type: "theme", name: "shared" });
		fellowship.sort = 0;
		fellowship.system = { isFellowship: true };

		const { model } = makeHero({ items: [own, fellowship] });

		expect(model.themes.map((t) => t.theme.name)).toEqual(["mine"]);
	});

	it("excludes non-theme items", () => {
		const theme = fakeItem({ type: "theme" });
		theme.sort = 0;
		theme.system = { isFellowship: false };
		const trope = fakeItem({ type: "trope" });
		const backpack = fakeItem({ type: "backpack" });

		const { model } = makeHero({ items: [theme, trope, backpack] });

		expect(model.themes.map((t) => t.theme.type)).toEqual(["theme"]);
	});
});

describe("HeroData.backpackItem / backpack", () => {
	it("backpackItem finds the hero's backpack", () => {
		const backpack = fakeItem({ type: "backpack" });
		const theme = fakeItem({ type: "theme" });
		const { model } = makeHero({ items: [theme, backpack] });

		expect(model.backpackItem).toBe(backpack);
	});

	it("backpackItem is null when no backpack item is present", () => {
		const { model } = makeHero({ items: [] });
		expect(model.backpackItem).toBeNull();
	});

	it("backpack reads system.tags from the backpack item", () => {
		const backpack = fakeItem({ type: "backpack" });
		backpack.system = { tags: ["a", "b"] };
		const { model } = makeHero({ items: [backpack] });

		expect(model.backpack).toEqual(["a", "b"]);
	});

	it("backpack returns [] when no backpack item exists", () => {
		const { model } = makeHero({ items: [] });
		expect(model.backpack).toEqual([]);
	});
});

describe("HeroData.relationships", () => {
	it("is populated from allApplicableEffects after prepareDerivedData", () => {
		const rel = fakeEffect({
			type: "relationship_tag",
			name: "Bond",
			system: {},
		});
		const status = fakeEffect({
			type: "status_tag",
			name: "Tired",
			system: { active: true, currentTier: 0 },
		});
		const { model } = makeHero({ effects: [rel, status] });

		// Before prepare: empty (the mixin's _effectBuckets is {})
		expect(model.relationships).toEqual([]);

		model.prepareDerivedData();

		expect(model.relationships).toEqual([rel]);
	});

	it("partitions story_tag and status_tag into the mixin's caches in one pass", () => {
		const story = fakeEffect({ type: "story_tag", name: "blessed" });
		const status = fakeEffect({
			type: "status_tag",
			name: "tired",
			system: { active: true, currentTier: 0 },
		});
		const { model } = makeHero({ effects: [story, status] });

		model.prepareDerivedData();

		expect(model.storyTags).toEqual([story]);
		expect(model.statusEffects).toEqual([status]);
	});
});

describe("HeroData.scratchedTags", () => {
	it("collects scratched power/story/fellowship tags but excludes weakness and status", () => {
		const scratchedPower = fakeEffect({
			type: "power_tag",
			name: "burned",
			system: { isScratched: true },
		});
		const scratchedWeakness = fakeEffect({
			type: "weakness_tag",
			name: "proud",
			system: { isScratched: true },
		});
		const unscratched = fakeEffect({
			type: "power_tag",
			name: "fresh",
			system: { isScratched: false },
		});
		const scratchedStatus = fakeEffect({
			type: "status_tag",
			name: "tired",
			system: { isScratched: true },
		});

		const { model } = makeHero({
			effects: [
				scratchedPower,
				scratchedWeakness,
				unscratched,
				scratchedStatus,
			],
		});

		expect(model.scratchedTags).toEqual([scratchedPower]);
	});

	it("merges scratched tags from the fellowship actor when one is linked", () => {
		const heroScratched = fakeEffect({
			type: "power_tag",
			name: "h",
			system: { isScratched: true },
		});
		const fellowshipScratched = fakeEffect({
			type: "fellowship_tag",
			name: "f",
			system: { isScratched: true },
		});
		const fellowshipActor = fakeActor({
			type: "fellowship",
			effects: [fellowshipScratched],
		});

		const { model } = makeHero({
			effects: [heroScratched],
			fellowshipId: fellowshipActor.id,
			fellowshipActor,
		});

		const names = model.scratchedTags.map((e) => e.name).sort();
		expect(names).toEqual(["f", "h"]);
	});
});

describe("HeroData.fellowshipActor", () => {
	it("returns null when useFellowship setting is false", () => {
		game.settings.get.mockImplementation(() => false);
		const { model } = makeHero({ fellowshipId: "anything" });
		expect(model.fellowshipActor).toBeNull();
	});

	it("looks up by fellowshipId when set and the actor exists", () => {
		const fellowship = fakeActor({ type: "fellowship", id: "f-1" });
		game.actors.get.mockImplementation((id) =>
			id === "f-1" ? fellowship : null,
		);

		const { model } = makeHero({ fellowshipId: "f-1" });
		expect(model.fellowshipActor).toBe(fellowship);
	});

	it("falls back to game.litmv2.fellowship when no id is set", () => {
		const fellowship = fakeActor({ type: "fellowship" });
		globalThis.game.litmv2 = { fellowship };
		try {
			const { model } = makeHero({ fellowshipId: "" });
			expect(model.fellowshipActor).toBe(fellowship);
		} finally {
			delete globalThis.game.litmv2;
		}
	});
});
