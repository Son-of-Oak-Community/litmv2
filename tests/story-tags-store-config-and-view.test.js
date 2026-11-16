import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeConfig } from "../modules/apps/story-tags/story-tag-helpers.js";
import { StoryTagsStore } from "../modules/apps/story-tags/story-tags-store.js";
import { LitmConfig } from "../modules/system/config.js";

// The `storytags` world setting is the sidebar's whole memory: which actors
// have a column and which of them are hidden from the players. The store
// normalizes it on every read and, on a Narrator's client, writes the
// normalized copy back, so a wrong rule here silently drops columns or
// concealment for good. The second half pins what the store hands a player:
// CLAUDE.md, "A hidden tag or status is never shown to the player it is hidden
// from, on any surface".

const original = CONFIG.litmv2;
const originalUser = game.user;
const originalUsers = game.users;
const originalActors = game.actors;
const originalPacks = game.packs;

let config;
let docs;

/** Close enough to Foundry's parseUuid for the shapes a config can hold. */
const parseUuid = (uuid) => {
	const parts = typeof uuid === "string" ? uuid.split(".") : [];
	if (parts.length < 2) return {};
	return { collection: {}, type: parts.at(-2), id: parts.at(-1) };
};

const worldActor = (id, over = {}) => {
	const doc = {
		id,
		uuid: `Actor.${id}`,
		documentName: "Actor",
		type: "challenge",
		name: id,
		img: `${id}.webp`,
		isOwner: false,
		system: { storyTags: [], statusEffects: [] },
		...over,
	};
	docs.set(doc.uuid, doc);
	return doc;
};

const tag = (name, { isHidden = false, disabled = false, sort = 0 } = {}) => ({
	id: name,
	_id: name,
	uuid: `Effect.${name}`,
	name,
	type: "story_tag",
	disabled,
	sort,
	system: { isHidden },
});

beforeEach(() => {
	CONFIG.litmv2 = Object.create(LitmConfig);
	docs = new Map();
	config = { actors: [], hiddenActors: [], limits: [] };
	game.user = { id: "player", isGM: false };
	game.users = Object.assign([], { activeGM: null, get: vi.fn() });
	game.ready = true;
	game.litmv2 = {};
	game.actors = { has: (id) => docs.has(`Actor.${id}`) };
	game.packs = { get: () => ({ contents: [] }) };
	game.settings.get.mockImplementation((_scope, key) =>
		key === "storytags" ? config : undefined,
	);
	game.settings.set.mockResolvedValue(undefined);
	foundry.utils.parseUuid = parseUuid;
	foundry.utils.fromUuidSync.mockImplementation(
		(uuid) => docs.get(uuid) ?? null,
	);
	StoryTagsStore.invalidateCache();
});

afterEach(() => {
	game.settings.get.mockReset();
	game.settings.set.mockReset();
	foundry.utils.fromUuidSync.mockReset();
	delete foundry.utils.parseUuid;
	delete game.ready;
	delete game.litmv2;
	CONFIG.litmv2 = original;
	game.user = originalUser;
	game.users = originalUsers;
	game.actors = originalActors;
	game.packs = originalPacks;
	StoryTagsStore.invalidateCache();
});

describe("normalizeConfig", () => {
	it("hands back the very same object when there is nothing to fix", () => {
		const raw = {
			actors: ["Actor.a", "Scene.s.Token.t.Actor.b"],
			hiddenActors: ["Actor.a"],
			limits: [{ id: "L1" }],
		};

		const { config: out, changed } = normalizeConfig(raw);

		expect(changed).toBe(false);
		expect(out).toBe(raw);
	});

	it("turns a legacy bare id into the actor's uuid, in both lists", () => {
		worldActor("ogre");

		const { config: out, changed } = normalizeConfig({
			actors: ["ogre", "Actor.wolf"],
			hiddenActors: ["ogre"],
			limits: [],
		});

		expect(changed).toBe(true);
		expect(out.actors).toEqual(["Actor.ogre", "Actor.wolf"]);
		expect(out.hiddenActors).toEqual(["Actor.ogre"]);
	});

	it("fixes the hidden list even when the tracked list is already clean", () => {
		worldActor("ogre");

		const { config: out, changed } = normalizeConfig({
			actors: ["Actor.ogre"],
			hiddenActors: ["ogre"],
		});

		expect(changed).toBe(true);
		expect(out.hiddenActors).toEqual(["Actor.ogre"]);
	});

	it("drops a bare id that names no actor in the world", () => {
		const { config: out, changed } = normalizeConfig({
			actors: ["ghost", "Actor.wolf"],
			hiddenActors: ["ghost"],
		});

		expect(changed).toBe(true);
		expect(out.actors).toEqual(["Actor.wolf"]);
		expect(out.hiddenActors).toEqual([]);
	});

	it.each([
		["an empty string", ""],
		["whitespace", "   "],
		["null", null],
		["a number", 7],
		["an Item uuid", "Item.sword"],
	])("drops %s", (_label, entry) => {
		const { config: out, changed } = normalizeConfig({
			actors: [entry, "Actor.wolf"],
			hiddenActors: [],
		});

		expect(changed).toBe(true);
		expect(out.actors).toEqual(["Actor.wolf"]);
	});

	it("trims a uuid that was stored with stray whitespace", () => {
		const { config: out, changed } = normalizeConfig({
			actors: [" Actor.wolf "],
			hiddenActors: [],
		});

		expect(changed).toBe(true);
		expect(out.actors).toEqual(["Actor.wolf"]);
	});

	it("replaces a token's uuid with its actor's, and drops a token that is gone", () => {
		docs.set("Scene.s.Token.t", {
			documentName: "Token",
			actor: { uuid: "Scene.s.Token.t.Actor.bandit" },
		});

		const { config: out } = normalizeConfig({
			actors: ["Scene.s.Token.t", "Scene.s.Token.gone"],
			hiddenActors: ["Scene.s.Token.t"],
		});

		expect(out.actors).toEqual(["Scene.s.Token.t.Actor.bandit"]);
		expect(out.hiddenActors).toEqual(["Scene.s.Token.t.Actor.bandit"]);
	});

	it("keeps concealment for an actor that no longer has a column", () => {
		const { config: out } = normalizeConfig({
			actors: [" Actor.wolf"],
			hiddenActors: ["Actor.removed"],
		});

		expect(out.hiddenActors).toEqual(["Actor.removed"]);
	});

	it("keeps the limits and every other key while it fixes the lists", () => {
		const { config: out } = normalizeConfig({
			actors: [""],
			limits: [{ id: "L1", label: "Doom", max: 3 }],
			extra: "kept",
		});

		expect(out.limits).toEqual([{ id: "L1", label: "Doom", max: 3 }]);
		expect(out.extra).toBe("kept");
		expect(out.tags).toEqual([]);
	});

	it("repairs a config whose limits were stored as something else", () => {
		const { config: out } = normalizeConfig({ actors: [""], limits: null });
		expect(out.limits).toEqual([]);
	});
});

describe("StoryTagsStore.config", () => {
	it("is an empty config when the setting is unset or empty", () => {
		config = undefined;
		expect(StoryTagsStore.config).toEqual({ actors: [], limits: [] });
		config = {};
		expect(StoryTagsStore.config).toEqual({ actors: [], limits: [] });
		expect(game.settings.set).not.toHaveBeenCalled();
	});

	it("is saved back by the Narrator's client once it had to be fixed", () => {
		game.user.isGM = true;
		worldActor("ogre");
		config = { actors: ["ogre"], hiddenActors: ["ogre"], limits: [] };

		const read = StoryTagsStore.config;

		expect(read.actors).toEqual(["Actor.ogre"]);
		expect(game.settings.set).toHaveBeenCalledTimes(1);
		expect(game.settings.set).toHaveBeenCalledWith("litmv2", "storytags", {
			actors: ["Actor.ogre"],
			hiddenActors: ["Actor.ogre"],
			limits: [],
			tags: [],
		});
	});

	it("is fixed for reading but never saved by a player's client", () => {
		worldActor("ogre");
		config = { actors: ["ogre"], hiddenActors: [], limits: [] };

		expect(StoryTagsStore.config.actors).toEqual(["Actor.ogre"]);
		expect(game.settings.set).not.toHaveBeenCalled();
	});

	it("is not saved before the world is ready, when actors may not resolve yet", () => {
		game.user.isGM = true;
		game.ready = false;
		config = { actors: ["ogre"], hiddenActors: ["ogre"], limits: [] };

		StoryTagsStore.config;

		expect(game.settings.set).not.toHaveBeenCalled();
	});

	it("is not saved when nothing had to be fixed", () => {
		game.user.isGM = true;
		config = { actors: ["Actor.ogre"], hiddenActors: [], limits: [] };

		expect(StoryTagsStore.config).toBe(config);
		expect(game.settings.set).not.toHaveBeenCalled();
	});
});

// "concealment is a property of the actor, not of the column it was reached
// through: an actor tracked by several uuids (its own and an unlinked token's)
// stays visible as long as one of those columns is."
describe("an actor tracked through more than one column", () => {
	const tokenUuid = "Scene.s.Token.t.Actor.bandit";

	beforeEach(() => {
		worldActor("bandit");
		// The unlinked token's synthetic actor: its own uuid, the same id.
		docs.set(tokenUuid, {
			id: "bandit",
			uuid: tokenUuid,
			documentName: "Actor",
			type: "challenge",
			name: "bandit",
			system: { storyTags: [], statusEffects: [] },
		});
	});

	it("is not concealed while one of its columns is still visible", () => {
		config = {
			actors: ["Actor.bandit", tokenUuid],
			hiddenActors: [tokenUuid],
			limits: [],
		};

		expect(StoryTagsStore.hiddenActorIds.has("bandit")).toBe(false);
		expect(StoryTagsStore.concealedActorIds.has("bandit")).toBe(false);
	});

	it("is concealed once every one of its columns is hidden", () => {
		config = {
			actors: ["Actor.bandit", tokenUuid],
			hiddenActors: ["Actor.bandit", tokenUuid],
			limits: [],
		};

		expect(StoryTagsStore.hiddenActorIds.has("bandit")).toBe(true);
	});

	it("is concealed by a hidden column that was removed, if no visible one remains", () => {
		config = { actors: [], hiddenActors: [tokenUuid], limits: [] };

		expect(StoryTagsStore.hiddenActorIds.has("bandit")).toBe(true);
	});
});

describe("the columns the store hands a viewer", () => {
	let ogre;

	beforeEach(() => {
		ogre = worldActor("ogre", {
			system: {
				maskedName: null,
				storyTags: [tag("club")],
				statusEffects: [],
			},
		});
		worldActor("hero", {
			type: "hero",
			isOwner: true,
			system: {
				storyTags: [
					tag("rope", { sort: 2 }),
					tag("cursed coin", { isHidden: true, sort: 1 }),
					tag("spent torch", { disabled: true, sort: 0 }),
					tag("lantern", { sort: 1 }),
				],
				statusEffects: [],
			},
		});
		config = {
			actors: ["Actor.ogre", "Actor.hero"],
			hiddenActors: ["Actor.ogre"],
			limits: [],
		};
	});

	const column = (id) => StoryTagsStore.actors.find((a) => a.id === id);

	it("leaves a hidden column out for a player", () => {
		expect(StoryTagsStore.actors.map((a) => a.id)).toEqual(["Actor.hero"]);
	});

	it("gives the Narrator the hidden column too, marked hidden", () => {
		game.user.isGM = true;

		expect(column("Actor.ogre")).toMatchObject({ hidden: true, name: "ogre" });
		expect(column("Actor.hero").hidden).toBe(false);
	});

	it("leaves a hidden tag out of a visible column for a player, its owner included", () => {
		expect(column("Actor.hero").tags.map((t) => t.name)).toEqual([
			"lantern",
			"rope",
		]);
	});

	it("gives the Narrator the hidden tag, flagged, in sort order", () => {
		game.user.isGM = true;

		const tags = column("Actor.hero").tags;
		expect(tags.map((t) => t.name)).toEqual(["cursed coin", "lantern", "rope"]);
		expect(tags.find((t) => t.name === "cursed coin").hidden).toBe(true);
	});

	it("never lists a deactivated tag", () => {
		game.user.isGM = true;

		expect(column("Actor.hero").tags.map((t) => t.name)).not.toContain(
			"spent torch",
		);
	});

	it("names a concealed Challenge by its alias", () => {
		config.hiddenActors = [];
		ogre.system.maskedName = "Something Stirs";

		expect(column("Actor.ogre").name).toBe("Something Stirs");
	});

	it("numbers columns that would otherwise share a name", () => {
		config = {
			actors: ["Actor.ogre", "Actor.twin"],
			hiddenActors: [],
			limits: [],
		};
		worldActor("twin", { name: "ogre" });

		expect(StoryTagsStore.actors.map((a) => a.name)).toEqual([
			"ogre (1)",
			"ogre (2)",
		]);
	});

	it("carries each column's own ownership", () => {
		config.hiddenActors = [];

		expect(column("Actor.hero").isOwner).toBe(true);
		expect(column("Actor.ogre").isOwner).toBe(false);
	});
});

describe("the scene tags the store hands a viewer", () => {
	beforeEach(() => {
		const pack = [
			tag("thick fog", { sort: 2 }),
			tag("hidden pit", { isHidden: true, sort: 1 }),
			tag("campfire", { sort: 0 }),
		];
		game.packs = { get: () => ({ contents: pack }) };
	});

	it("leaves hidden scene tags out for a player", () => {
		expect(StoryTagsStore.tags.map((t) => t.name)).toEqual([
			"campfire",
			"thick fog",
		]);
	});

	it("gives the Narrator every scene tag, in sort order", () => {
		game.user.isGM = true;

		expect(StoryTagsStore.tags.map((t) => t.name)).toEqual([
			"campfire",
			"hidden pit",
			"thick fog",
		]);
	});

	it("is empty when the pack is missing", () => {
		game.packs = { get: () => undefined };
		expect(StoryTagsStore.tags).toEqual([]);
	});
});
