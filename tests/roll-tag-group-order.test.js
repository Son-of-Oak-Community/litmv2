import { afterEach, describe, expect, it } from "vitest";
import {
	buildContributedTagGroups,
	buildOwnerContext,
} from "../modules/apps/roll/roll-dialog-context.js";

// Groups come out by category — story tags, statuses, backpack, themes, story
// themes, relationships — not in the order the actor's effects are stored.
describe("roll tag groups by category", () => {
	afterEach(() => {
		delete game.user.character;
	});

	it("lists the backpack before themes, and relationships last", () => {
		const theme = { id: "t1", name: "Skilled with a Bow", img: null };
		const backpack = { id: "b1", name: "Backpack", img: null };
		const hero = {
			id: "h2",
			type: "hero",
			name: "Helper",
			img: null,
			system: { backpackItem: backpack },
			items: { get: () => ({ type: "theme" }) },
			effects: [
				{
					uuid: "e1",
					name: "Rope",
					type: "story_tag",
					parent: backpack,
					active: true,
				},
				{
					uuid: "e2",
					name: "Old friend",
					type: "relationship_tag",
					parent: null,
					active: true,
					system: { targetHero: { id: "h1" } },
				},
				{
					uuid: "e3",
					name: "Father's yew bow",
					type: "power_tag",
					parent: theme,
					active: true,
				},
			],
			// Foundry caches the active ones here; the Classic look reads it.
			get appliedEffects() {
				return [...this.allApplicableEffects()].filter((e) => e.active);
			},
			allApplicableEffects() {
				return this.effects;
			},
		};
		hero.effects[1].parent = hero;
		game.user.character = hero;
		const dialog = { actorId: "h1", getSelection: () => ({}) };
		const [helper] = buildContributedTagGroups(dialog, {
			decorateTag: (tag) => ({ ...tag, states: "" }),
			tagTypeOrder: {},
			isOwner: false,
		});
		expect(helper.themeGroups.map((g) => g.themeName)).toEqual([
			"Backpack",
			"Skilled with a Bow",
			"LITM.Terms.relationship",
		]);
	});

	it("orders the roller's own Hero and Fellowship tabs the same way", () => {
		const fx = (name, type) => ({
			uuid: name,
			name,
			type,
			active: true,
			system: {},
		});
		const dialog = {
			getSelection: () => ({}),
			actor: {
				system: {
					themes: [
						{ theme: { name: "Theme" }, tags: [fx("bow", "power_tag")] },
					],
					storyThemes: [
						{ theme: { name: "Story Theme" }, tags: [fx("x", "power_tag")] },
					],
					storyTags: [fx("rope", "story_tag")],
					backpackItem: { name: "Backpack" },
					statusEffects: [fx("hurt", "status_tag")],
					relationships: [fx("friend", "relationship_tag")],
					fellowship: {
						themes: [
							{
								theme: { name: "Fellowship" },
								tags: [fx("bond", "fellowship_tag")],
							},
						],
						tags: [fx("camp", "story_tag"), fx("tired", "status_tag")],
					},
				},
			},
		};
		const { characterTagGroups, fellowshipTagGroups } = buildOwnerContext(
			dialog,
			{
				decorateTag: (tag) => tag,
			},
		);
		expect(characterTagGroups.map((g) => g.themeName)).toEqual([
			"LITM.Terms.statuses",
			"Backpack",
			"Theme",
			"Story Theme",
		]);
		expect(fellowshipTagGroups.map((g) => g.themeName)).toEqual([
			"LITM.Terms.story_tags",
			"LITM.Terms.statuses",
			"Fellowship",
			"LITM.Terms.relationship",
		]);
	});

	it("tells each theme card its banner: Might level, or Fellowship gold", () => {
		const fx = (name, type) => ({
			uuid: name,
			name,
			type,
			active: true,
			system: {},
		});
		const dialog = {
			getSelection: () => ({}),
			actor: {
				system: {
					themes: [
						{
							theme: { name: "Bow", system: { level: "adventure" } },
							tags: [fx("bow", "power_tag")],
						},
					],
					storyThemes: [],
					storyTags: [],
					statusEffects: [fx("hurt", "status_tag")],
					relationships: [],
					fellowship: {
						themes: [
							{
								theme: { name: "Amulet", system: { isFellowship: true } },
								tags: [fx("bond", "fellowship_tag")],
							},
						],
						tags: [],
					},
				},
			},
		};
		const { characterTagGroups, fellowshipTagGroups } = buildOwnerContext(
			dialog,
			{
				decorateTag: (tag) => tag,
			},
		);
		const bow = characterTagGroups.find((g) => g.themeName === "Bow");
		const statuses = characterTagGroups.find(
			(g) => g.themeName === "LITM.Terms.statuses",
		);
		expect(bow.level).toBe("adventure");
		expect(statuses.level).toBeUndefined();
		expect(statuses.banner).toBeUndefined();
		expect(
			fellowshipTagGroups.find((g) => g.themeName === "Amulet").banner,
		).toBe("fellowship");
	});

	// A scratched tag stays on its theme's card, struck through and locked
	// by the decorator, so the card still reads as the whole theme.
	it("keeps a theme's scratched tags on its card", () => {
		const fx = (name, extra = {}) => ({
			uuid: name,
			name,
			type: "power_tag",
			active: true,
			system: {},
			...extra,
		});
		const dialog = {
			isCardsLook: true,
			getSelection: () => ({}),
			actor: {
				system: {
					themes: [
						{
							theme: { name: "Bow", system: { level: "origin" } },
							tags: [
								fx("Bow"),
								fx("Burned", { active: false, system: { isScratched: true } }),
								fx("Off", { active: false }),
								fx("Off and burned", {
									active: false,
									disabled: true,
									system: { isScratched: true },
								}),
							],
						},
					],
					storyThemes: [],
					storyTags: [],
					statusEffects: [],
					relationships: [],
					fellowship: { themes: [], tags: [] },
				},
			},
		};
		const { characterTagGroups } = buildOwnerContext(dialog, {
			decorateTag: (tag) => tag,
		});
		const bow = characterTagGroups.find((g) => g.themeName === "Bow");
		expect(bow.tags.map((tag) => tag.name)).toEqual(["Bow", "Burned"]);

		// Classic lists only what is in play.
		const classic = buildOwnerContext(
			{ ...dialog, isCardsLook: false },
			{ decorateTag: (tag) => tag },
		).characterTagGroups.find((g) => g.themeName === "Bow");
		expect(classic.tags.map((tag) => tag.name)).toEqual(["Bow"]);
	});

	it("gives a helper's theme card its Might level too", () => {
		const theme = { id: "t1", name: "Deer Stalker", img: null };
		const hero = {
			id: "h2",
			type: "hero",
			name: "Helper",
			img: null,
			system: {},
			items: {
				get: () => ({ type: "theme", sort: 0, system: { level: "greatness" } }),
			},
			// Foundry caches the active ones here; the Classic look reads it.
			get appliedEffects() {
				return [...this.allApplicableEffects()].filter((e) => e.active);
			},
			allApplicableEffects: () => [
				{
					uuid: "e3",
					name: "Keen senses",
					type: "power_tag",
					parent: theme,
					active: true,
				},
			],
		};
		game.user.character = hero;
		const [helper] = buildContributedTagGroups(
			{ actorId: "h1", getSelection: () => ({}) },
			{ decorateTag: (tag) => ({ ...tag, states: "" }), isOwner: false },
		);
		expect(helper.themeGroups[0].level).toBe("greatness");
	});

	// Legacy heroes' themes all sit at sort 0: name order, as the sheet lists them.
	it("breaks a sort tie by theme name, as HeroData#themes does", () => {
		const themes = ["Theme 10", "Theme 2", "Theme 1"].map((name, i) => ({
			id: `t${i}`,
			name,
			img: null,
		}));
		const hero = {
			id: "h2",
			type: "hero",
			name: "Helper",
			img: null,
			system: {},
			items: { get: () => ({ type: "theme", sort: 0, system: {} }) },
			get appliedEffects() {
				return themes.map((theme, i) => ({
					uuid: `e${i}`,
					name: `tag ${i}`,
					type: "power_tag",
					parent: theme,
					active: true,
				}));
			},
		};
		game.user.character = hero;
		const [helper] = buildContributedTagGroups(
			{ actorId: "h1", getSelection: () => ({}) },
			{ decorateTag: (tag) => ({ ...tag, states: "" }), isOwner: false },
		);
		expect(helper.themeGroups.map((g) => g.themeName)).toEqual([
			"Theme 1",
			"Theme 2",
			"Theme 10",
		]);
	});

	// As on the Cards sheet: a story theme's image is its portrait, so its
	// banner carries the level's icon and colour.
	it("heads a story theme's card with its level, for the roller and a helper", () => {
		const fx = (name) => ({
			uuid: name,
			name,
			type: "power_tag",
			active: true,
			system: {},
		});
		const story = {
			type: "story_theme",
			name: "Haunted",
			img: "icons/svg/item-bag.svg",
			sort: 0,
			system: { level: "greatness" },
		};
		const ownerDialog = (isCardsLook) => ({
			isCardsLook,
			getSelection: () => ({}),
			actor: {
				system: {
					themes: [],
					storyThemes: [{ theme: story, tags: [fx("Haunted")] }],
					storyTags: [],
					statusEffects: [],
					relationships: [],
					fellowship: { themes: [], tags: [] },
				},
			},
		});
		const { characterTagGroups } = buildOwnerContext(ownerDialog(true), {
			decorateTag: (tag) => tag,
		});
		const own = characterTagGroups.find((g) => g.themeName === "Haunted");
		expect(own.level).toBe("greatness");
		expect(own.themeImg).toBe(
			"systems/litmv2/assets/media/icons/greatness.svg",
		);

		game.user.character = {
			id: "h2",
			type: "hero",
			name: "Helper",
			img: null,
			system: {},
			items: { get: () => story },
			// Foundry caches the active ones here; the Classic look reads it.
			get appliedEffects() {
				return [...this.allApplicableEffects()].filter((e) => e.active);
			},
			allApplicableEffects: () => [
				{
					...fx("Ghostly"),
					parent: { id: "s1", name: "Haunted", img: story.img },
				},
			],
		};
		const [helper] = buildContributedTagGroups(
			{ actorId: "h1", isCardsLook: true, getSelection: () => ({}) },
			{ decorateTag: (tag) => ({ ...tag, states: "" }), isOwner: false },
		);
		expect(helper.themeGroups[0].level).toBe("greatness");
		expect(helper.themeGroups[0].themeImg).toBe(own.themeImg);

		// Classic keeps the story theme's own image.
		const classic = buildOwnerContext(ownerDialog(false), {
			decorateTag: (tag) => tag,
		}).characterTagGroups.find((g) => g.themeName === "Haunted");
		expect(classic.themeImg).toBe(story.img);
	});

	// A helper's card, like the roller's, keeps its enabled scratched theme
	// tags; a disabled one, or a scratched backpack tag, stays off it.
	it("keeps a helper's scratched theme tags on its card", () => {
		const theme = { id: "t1", name: "Deer Stalker", img: null, type: "theme" };
		const backpack = {
			id: "b1",
			name: "Backpack",
			img: null,
			type: "backpack",
		};
		const fx = (name, parent, extra = {}) => ({
			uuid: name,
			name,
			type: parent === theme ? "power_tag" : "story_tag",
			parent,
			active: true,
			system: {},
			...extra,
		});
		const burned = { active: false, system: { isScratched: true } };
		const hero = {
			id: "h2",
			type: "hero",
			name: "Helper",
			img: null,
			system: { backpackItem: backpack },
			items: {
				get: (id) =>
					id === "t1" ? { type: "theme", sort: 0, system: {} } : null,
			},
			// Foundry caches the active ones here; the Classic look reads it.
			get appliedEffects() {
				return [...this.allApplicableEffects()].filter((e) => e.active);
			},
			allApplicableEffects: () => [
				fx("Keen senses", theme),
				fx("Quiet communion", theme, burned),
				fx("Trade game", theme, { ...burned, disabled: true }),
				fx("Rope", backpack, burned),
			],
		};
		game.user.character = hero;
		const helperNames = (isCardsLook) =>
			buildContributedTagGroups(
				{ actorId: "h1", isCardsLook, getSelection: () => ({}) },
				{ decorateTag: (tag) => ({ ...tag, states: "" }), isOwner: false },
			)[0].themeGroups.flatMap((g) => g.tags.map((tag) => tag.name));
		expect(helperNames(true)).toEqual(["Keen senses", "Quiet communion"]);
		expect(helperNames(false)).toEqual(["Keen senses"]);
	});
});
