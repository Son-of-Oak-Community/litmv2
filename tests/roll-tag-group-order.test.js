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
			appliedEffects: [
				{ uuid: "e1", name: "Rope", type: "story_tag", parent: backpack },
				{
					uuid: "e2",
					name: "Old friend",
					type: "relationship_tag",
					parent: null,
					system: { targetHero: { id: "h1" } },
				},
				{ uuid: "e3", name: "Father's yew bow", type: "power_tag", parent: theme },
			],
		};
		hero.appliedEffects[1].parent = hero;
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
		const fx = (name, type) => ({ uuid: name, name, type, active: true, system: {} });
		const dialog = {
			getSelection: () => ({}),
			actor: {
				system: {
					themes: [{ theme: { name: "Theme" }, tags: [fx("bow", "power_tag")] }],
					storyThemes: [{ theme: { name: "Story Theme" }, tags: [fx("x", "power_tag")] }],
					storyTags: [fx("rope", "story_tag")],
					backpackItem: { name: "Backpack" },
					statusEffects: [fx("hurt", "status_tag")],
					relationships: [fx("friend", "relationship_tag")],
					fellowship: {
						themes: [{ theme: { name: "Fellowship" }, tags: [fx("bond", "fellowship_tag")] }],
						tags: [fx("camp", "story_tag"), fx("tired", "status_tag")],
					},
				},
			},
		};
		const { characterTagGroups, fellowshipTagGroups } = buildOwnerContext(dialog, {
			decorateTag: (tag) => tag,
		});
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
});
