import { beforeEach, describe, expect, it } from "vitest";
import {
	buildAllyTagGroups,
	buildSceneActorTagGroups,
} from "../modules/apps/roll/roll-dialog-context.js";

/**
 * buildAllyTagGroups / buildSceneActorTagGroups — the sidebar-sourced
 * per-actor groups exposing other fellowship heroes' (Allies tab) and the
 * scene opposition's (Scene tab) visible tags and statuses to the roller.
 */

const TAG_TYPE_ORDER = { status_tag: 0, story_tag: 1 };

const makeTag = (uuid, name, type = "story_tag") => ({
	id: uuid.split(".").at(-1),
	uuid,
	name,
	type,
	system: {},
});

const makeDialog = ({ actors = [], selections = new Map() } = {}) => ({
	actor: { uuid: "Actor.rolling" },
	storyTagSidebar: { actors },
	getSelection: (uuid) =>
		selections.get(uuid) ?? { state: "", contributorId: null },
});

const shared = (isOwner = true) => ({
	decorateTag: (tag) => tag,
	tagTypeOrder: TAG_TYPE_ORDER,
	isOwner,
});

const heroEntry = (uuid, name, tags) => ({
	id: uuid,
	type: "hero",
	name,
	img: `${name}.webp`,
	tags,
});

describe("buildAllyTagGroups", () => {
	beforeEach(() => {
		game.user.character = null;
	});

	it("groups other heroes' tags and excludes the rolling actor", () => {
		const dialog = makeDialog({
			actors: [
				heroEntry("Actor.rolling", "Gilla", [
					makeTag("Actor.rolling.ActiveEffect.a", "own tag"),
				]),
				heroEntry("Actor.gerrin", "Gerrin", [
					makeTag("Actor.gerrin.ActiveEffect.b", "signal arrow"),
					makeTag("Actor.gerrin.ActiveEffect.c", "wounded", "status_tag"),
				]),
			],
		});
		const groups = buildAllyTagGroups(dialog, shared());
		expect(groups).toHaveLength(1);
		expect(groups[0].actorName).toBe("Gerrin");
		expect(groups[0].actorImg).toBe("Gerrin.webp");
		// status_tag sorts before story_tag per the type order
		expect(groups[0].tags.map((t) => t.name)).toEqual([
			"wounded",
			"signal arrow",
		]);
	});

	it("excludes non-hero actors entirely", () => {
		const dialog = makeDialog({
			actors: [
				{
					id: "Actor.challenge",
					type: "challenge",
					name: "Wolf",
					img: "wolf.webp",
					tags: [makeTag("Actor.challenge.ActiveEffect.x", "ferocious")],
				},
				{
					id: "Actor.fellowship",
					type: "fellowship",
					name: "Fellowship",
					img: "f.webp",
					tags: [makeTag("Actor.fellowship.ActiveEffect.y", "bonded")],
				},
			],
		});
		expect(buildAllyTagGroups(dialog, shared())).toEqual([]);
	});

	it("skips tags already attributed to a contributor", () => {
		const selections = new Map([
			[
				"Actor.gerrin.ActiveEffect.b",
				{
					state: "positive",
					contributorId: "user2",
					contributorActorId: "gerrin",
				},
			],
		]);
		const dialog = makeDialog({
			actors: [
				heroEntry("Actor.gerrin", "Gerrin", [
					makeTag("Actor.gerrin.ActiveEffect.b", "signal arrow"),
					makeTag("Actor.gerrin.ActiveEffect.c", "wounded", "status_tag"),
				]),
			],
			selections,
		});
		const groups = buildAllyTagGroups(dialog, shared());
		expect(groups[0].tags.map((t) => t.name)).toEqual(["wounded"]);
	});

	it("carries selection state onto decorated tags", () => {
		const selections = new Map([
			[
				"Actor.gerrin.ActiveEffect.c",
				{ state: "negative", contributorId: "user1" },
			],
		]);
		const dialog = makeDialog({
			actors: [
				heroEntry("Actor.gerrin", "Gerrin", [
					makeTag("Actor.gerrin.ActiveEffect.c", "wounded", "status_tag"),
				]),
			],
			selections,
		});
		const [group] = buildAllyTagGroups(dialog, shared());
		expect(group.tags[0].state).toBe("negative");
		expect(group.tags[0].contributorId).toBe("user1");
	});

	it("non-owner viewers only see selected tags", () => {
		const selections = new Map([
			[
				"Actor.gerrin.ActiveEffect.b",
				{ state: "positive", contributorId: "user1" },
			],
		]);
		const dialog = makeDialog({
			actors: [
				heroEntry("Actor.gerrin", "Gerrin", [
					makeTag("Actor.gerrin.ActiveEffect.b", "signal arrow"),
					makeTag("Actor.gerrin.ActiveEffect.c", "wounded", "status_tag"),
				]),
			],
			selections,
		});
		const groups = buildAllyTagGroups(dialog, shared(false));
		expect(groups).toHaveLength(1);
		expect(groups[0].tags.map((t) => t.name)).toEqual(["signal arrow"]);
	});

	it("non-owner viewers never see their own character's group", () => {
		game.user.character = { uuid: "Actor.gerrin" };
		const selections = new Map([
			[
				"Actor.gerrin.ActiveEffect.b",
				{ state: "positive", contributorId: "user1" },
			],
		]);
		const dialog = makeDialog({
			actors: [
				heroEntry("Actor.gerrin", "Gerrin", [
					makeTag("Actor.gerrin.ActiveEffect.b", "signal arrow"),
				]),
			],
			selections,
		});
		expect(buildAllyTagGroups(dialog, shared(false))).toEqual([]);
	});

	it("drops heroes with no visible tags", () => {
		const dialog = makeDialog({
			actors: [heroEntry("Actor.gerrin", "Gerrin", [])],
		});
		expect(buildAllyTagGroups(dialog, shared())).toEqual([]);
	});

	it("threads the sidebar actor type onto each tag", () => {
		const dialog = makeDialog({
			actors: [
				heroEntry("Actor.gerrin", "Gerrin", [
					makeTag("Actor.gerrin.ActiveEffect.b", "signal arrow"),
				]),
			],
		});
		const [group] = buildAllyTagGroups(dialog, shared());
		expect(group.tags[0].actorType).toBe("hero");
	});
});

describe("buildSceneActorTagGroups", () => {
	beforeEach(() => {
		game.user.character = null;
	});

	const challengeEntry = (uuid, name, tags) => ({
		id: uuid,
		type: "challenge",
		name,
		img: `${name}.webp`,
		tags,
	});

	it("groups challenge/journey/story_theme actors and excludes heroes", () => {
		const dialog = makeDialog({
			actors: [
				heroEntry("Actor.gerrin", "Gerrin", [
					makeTag("Actor.gerrin.ActiveEffect.b", "signal arrow"),
				]),
				challengeEntry("Actor.goat", "Goat man", [
					makeTag("Actor.goat.ActiveEffect.x", "cunning"),
					makeTag("Actor.goat.ActiveEffect.y", "cool", "status_tag"),
				]),
				{
					id: "Actor.road",
					type: "journey",
					name: "The Long Road",
					img: "road.webp",
					tags: [makeTag("Actor.road.ActiveEffect.z", "muddy paths")],
				},
			],
		});
		const groups = buildSceneActorTagGroups(dialog, shared());
		expect(groups.map((g) => g.actorName)).toEqual([
			"Goat man",
			"The Long Road",
		]);
		// actorType drives decorateTag's opposition cycle downstream
		expect(groups[0].tags.every((t) => t.actorType === "challenge")).toBe(
			true,
		);
	});

	it("non-owner viewers only see selected tags", () => {
		const selections = new Map([
			["Actor.goat.ActiveEffect.x", { state: "negative", contributorId: "u1" }],
		]);
		const dialog = makeDialog({
			actors: [
				challengeEntry("Actor.goat", "Goat man", [
					makeTag("Actor.goat.ActiveEffect.x", "cunning"),
					makeTag("Actor.goat.ActiveEffect.y", "cool", "status_tag"),
				]),
			],
			selections,
		});
		const groups = buildSceneActorTagGroups(dialog, shared(false));
		expect(groups).toHaveLength(1);
		expect(groups[0].tags.map((t) => t.name)).toEqual(["cunning"]);
	});
});
