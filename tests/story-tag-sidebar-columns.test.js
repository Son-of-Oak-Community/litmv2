import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryTagSidebar } from "../modules/apps/story-tags/story-tag-sidebar.js";
import { StoryTagsStore } from "../modules/apps/story-tags/story-tags-store.js";
import { LitmConfig } from "../modules/system/config.js";
import { ContentSources } from "../modules/system/content-sources.js";
import { Sockets } from "../modules/system/sockets.js";
import { setGM, setPlayer } from "./__helpers__/users.js";

// The sidebar's column writes: which actors it tracks and which of them are
// hidden from the players. CLAUDE.md: "Hiding a column also hides the actor on
// the canvas: its tokens on the scene are hidden ... A newly tracked actor's
// column starts from its tokens' state, so adding a column never makes a
// placed token vanish ... Removing an actor from the sidebar is not a reveal."
// These drive the real sidebar through its drop handler, its actions and
// `_toggleActorVisibility`, against a `storytags` setting that remembers what
// was written to it.

const original = CONFIG.litmv2;
const originalUser = game.user;
const originalUsers = game.users;
const originalActors = game.actors;
const originalPacks = game.packs;

let sidebar;
let config;
let world;
let scene;

/** A world actor the sidebar can resolve by uuid. */
function actor(id, type, over = {}) {
	const doc = {
		id,
		_id: id,
		uuid: `Actor.${id}`,
		documentName: "Actor",
		type,
		name: id,
		img: `${id}.webp`,
		isOwner: true,
		effects: { size: 0 },
		system: { tags: "", storyTags: [], statusEffects: [] },
		createEmbeddedDocuments: vi.fn().mockResolvedValue([]),
		...over,
	};
	world.set(doc.uuid, doc);
	return doc;
}

/** Put a token for `doc` on the scene. */
function placeToken(doc, { hidden = false } = {}) {
	const token = { id: `tok-${scene.tokens.length}`, actorId: doc.id, hidden };
	scene.tokens.push(token);
	canvas.tokens.placeables.push({ actor: doc, document: token });
	return token;
}

const dropActor = (data) =>
	sidebar._onDrop({
		dataTransfer: { getData: () => JSON.stringify({ type: "Actor", ...data }) },
		target: { closest: () => null },
	});

const action = (name, dataset = {}) =>
	StoryTagSidebar.DEFAULT_OPTIONS.actions[name].call(sidebar, null, {
		dataset,
	});

beforeEach(() => {
	vi.clearAllMocks();
	CONFIG.litmv2 = Object.create(LitmConfig);
	setGM();
	world = new Map();
	config = { actors: [], hiddenActors: [], limits: [] };
	game.settings.get.mockImplementation((_scope, key) =>
		key === "storytags" ? config : undefined,
	);
	game.settings.set.mockImplementation(async (_scope, key, value) => {
		if (key === "storytags") config = value;
		return value;
	});
	game.users = Object.assign([], { activeGM: null, get: vi.fn() });
	game.actors = {
		get: (id) => world.get(`Actor.${id}`) ?? null,
		has: (id) => world.has(`Actor.${id}`),
		find: (fn) => [...world.values()].find(fn),
		importDocument: vi.fn(),
	};
	game.packs = { get: () => ({ contents: [] }) };
	game.litmv2 = {};
	foundry.utils.parseUuid = (uuid) => ({
		collection: "Actor",
		type: uuid?.startsWith("Actor.") ? "Actor" : null,
	});
	foundry.utils.fromUuidSync.mockImplementation(
		(uuid) => world.get(uuid) ?? null,
	);
	scene = {
		tokens: [],
		updateEmbeddedDocuments: vi.fn().mockResolvedValue([]),
	};
	globalThis.canvas = { ready: true, scene, tokens: { placeables: [] } };
	StoryTagsStore.invalidateCache();
	sidebar = new StoryTagSidebar();
	sidebar.render = vi.fn();
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	game.settings.get.mockReset();
	game.settings.set.mockReset();
	foundry.utils.fromUuidSync.mockReset();
	delete foundry.utils.parseUuid;
	delete game.litmv2;
	globalThis.canvas = undefined;
	CONFIG.litmv2 = original;
	game.user = originalUser;
	game.users = originalUsers;
	game.actors = originalActors;
	game.packs = originalPacks;
	StoryTagsStore.invalidateCache();
});

describe("a newly tracked actor's column starts from its tokens", () => {
	it("starts a Challenge with no token on the scene hidden", async () => {
		const ogre = actor("ogre", "challenge");

		await dropActor({ uuid: ogre.uuid });

		expect(config.actors).toEqual(["Actor.ogre"]);
		expect(config.hiddenActors).toEqual(["Actor.ogre"]);
	});

	it("starts it visible when its token is already in plain sight", async () => {
		const ogre = actor("ogre", "challenge");
		placeToken(ogre, { hidden: false });

		await dropActor({ uuid: ogre.uuid });

		expect(config.actors).toEqual(["Actor.ogre"]);
		expect(config.hiddenActors).toEqual([]);
	});

	it("starts it hidden when every one of its tokens is hidden", async () => {
		const ogre = actor("ogre", "challenge");
		placeToken(ogre, { hidden: true });
		placeToken(ogre, { hidden: true });

		await dropActor({ uuid: ogre.uuid });

		expect(config.hiddenActors).toEqual(["Actor.ogre"]);
	});

	it("starts it visible when any one of its tokens is in plain sight", async () => {
		const ogre = actor("ogre", "challenge");
		placeToken(ogre, { hidden: true });
		placeToken(ogre, { hidden: false });

		await dropActor({ uuid: ogre.uuid });

		expect(config.hiddenActors).toEqual([]);
	});

	it("is not swayed by another actor's tokens", async () => {
		const ogre = actor("ogre", "challenge");
		placeToken(actor("wolf", "challenge"), { hidden: false });

		await dropActor({ uuid: ogre.uuid });

		expect(config.hiddenActors).toEqual(["Actor.ogre"]);
	});

	it.each(["journey", "story_theme"])(
		"starts a %s with no token hidden",
		async (type) => {
			const doc = actor("thing", type);
			await dropActor({ uuid: doc.uuid });
			expect(config.hiddenActors).toEqual(["Actor.thing"]);
		},
	);

	it.each(["hero", "fellowship"])(
		"never starts a %s hidden, hidden token or not",
		async (type) => {
			const doc = actor("party", type);
			placeToken(doc, { hidden: true });
			await dropActor({ uuid: doc.uuid });
			expect(config.actors).toEqual(["Actor.party"]);
			expect(config.hiddenActors).toEqual([]);
		},
	);

	it("keeps the columns and the hidden list that were already there", async () => {
		const wolf = actor("wolf", "challenge");
		config = {
			actors: ["Actor.wolf"],
			hiddenActors: ["Actor.wolf", "Actor.removed-earlier"],
			limits: [{ id: "L1", label: "Doom", max: 3 }],
		};
		const ogre = actor("ogre", "challenge");

		await dropActor({ uuid: ogre.uuid });

		expect(config.actors).toEqual([wolf.uuid, "Actor.ogre"]);
		expect(config.hiddenActors).toEqual([
			"Actor.wolf",
			"Actor.removed-earlier",
			"Actor.ogre",
		]);
		expect(config.limits).toEqual([{ id: "L1", label: "Doom", max: 3 }]);
	});

	it("resolves a drop that carries only an id", async () => {
		actor("ogre", "challenge");
		await dropActor({ id: "ogre" });
		expect(config.actors).toEqual(["Actor.ogre"]);
	});

	it("writes nothing for an actor that already has a column", async () => {
		const ogre = actor("ogre", "challenge");
		config = { actors: ["Actor.ogre"], hiddenActors: [], limits: [] };
		StoryTagsStore.invalidateCache();

		await dropActor({ uuid: ogre.uuid });

		expect(game.settings.set).not.toHaveBeenCalled();
	});

	it("writes nothing for an actor that does not resolve", async () => {
		await dropActor({ uuid: "Actor.gone" });
		expect(game.settings.set).not.toHaveBeenCalled();
	});

	it("tells every client, and the roll dialogs, that the columns changed", async () => {
		const ogre = actor("ogre", "challenge");

		await dropActor({ uuid: ogre.uuid });

		expect(Sockets.dispatch).toHaveBeenCalledWith("storyTagsRender");
		expect(Hooks.callAll).toHaveBeenCalledWith("litm.sceneTagsChanged");
	});

	it("turns an unopened Challenge's legacy tag string into effects on the way in", async () => {
		const ogre = actor("ogre", "challenge", {
			system: { tags: "[brute] [enraged-2]", storyTags: [], statusEffects: [] },
		});

		await dropActor({ uuid: ogre.uuid });

		const [kind, created] = ogre.createEmbeddedDocuments.mock.calls[0];
		expect(kind).toBe("ActiveEffect");
		expect(created.map((e) => [e.type, e.name])).toEqual([
			["story_tag", "brute"],
			["status_tag", "enraged"],
		]);
	});

	it("does not re-create effects for a Challenge that already has some", async () => {
		const ogre = actor("ogre", "challenge", {
			effects: { size: 1 },
			system: { tags: "[brute]", storyTags: [], statusEffects: [] },
		});

		await dropActor({ uuid: ogre.uuid });

		expect(ogre.createEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

describe("dropping a compendium actor", () => {
	const packUuid = "Compendium.world.bestiary.Actor.ogre";

	it("tracks a world copy of it, not the pack entry", async () => {
		const source = { uuid: packUuid };
		foundry.utils.fromUuid.mockResolvedValue(source);
		game.actors.importDocument.mockImplementation(async () =>
			actor("imported", "challenge"),
		);

		await dropActor({ uuid: packUuid });

		expect(game.actors.importDocument).toHaveBeenCalledWith(source);
		expect(config.actors).toEqual(["Actor.imported"]);
		foundry.utils.fromUuid.mockReset();
	});

	it("reuses the copy an earlier drop imported", async () => {
		actor("imported", "challenge", { _stats: { compendiumSource: packUuid } });

		await dropActor({ uuid: packUuid });

		expect(game.actors.importDocument).not.toHaveBeenCalled();
		expect(config.actors).toEqual(["Actor.imported"]);
	});

	it("tracks nothing when the pack entry is gone", async () => {
		foundry.utils.fromUuid.mockResolvedValue(null);

		await dropActor({ uuid: packUuid });

		expect(game.settings.set).not.toHaveBeenCalled();
		foundry.utils.fromUuid.mockReset();
	});
});

describe("Load scene tokens", () => {
	it("adds one column per actor on the scene, each starting from its tokens", async () => {
		const seen = actor("seen", "challenge");
		const lurker = actor("lurker", "challenge");
		const hero = actor("hero", "hero");
		placeToken(seen, { hidden: false });
		placeToken(seen, { hidden: false });
		placeToken(lurker, { hidden: true });
		placeToken(hero, { hidden: true });

		await action("load-scene-tokens");

		expect(config.actors).toEqual(["Actor.seen", "Actor.lurker", "Actor.hero"]);
		expect(config.hiddenActors).toEqual(["Actor.lurker"]);
	});

	it("skips actors that already have a column and keeps their hidden state", async () => {
		const seen = actor("seen", "challenge");
		const lurker = actor("lurker", "challenge");
		config = {
			actors: ["Actor.seen"],
			hiddenActors: ["Actor.seen"],
			limits: [],
		};
		StoryTagsStore.invalidateCache();
		placeToken(seen, { hidden: false });
		placeToken(lurker, { hidden: false });

		await action("load-scene-tokens");

		expect(config.actors).toEqual(["Actor.seen", "Actor.lurker"]);
		expect(config.hiddenActors).toEqual(["Actor.seen"]);
	});

	it("writes nothing when every token's actor is already tracked", async () => {
		const seen = actor("seen", "challenge");
		config = { actors: ["Actor.seen"], hiddenActors: [], limits: [] };
		StoryTagsStore.invalidateCache();
		placeToken(seen);
		canvas.tokens.placeables.push({ actor: null });

		await action("load-scene-tokens");

		expect(game.settings.set).not.toHaveBeenCalled();
	});
});

describe("hiding a column", () => {
	let ogre;

	beforeEach(() => {
		ogre = actor("ogre", "challenge");
		config = { actors: ["Actor.ogre"], hiddenActors: [], limits: [] };
	});

	it("hides the column and every token of that actor on the scene", async () => {
		const a = placeToken(ogre);
		const b = placeToken(ogre);
		placeToken(actor("wolf", "challenge"));

		await sidebar._toggleActorVisibility("Actor.ogre");

		expect(config.hiddenActors).toEqual(["Actor.ogre"]);
		expect(scene.updateEmbeddedDocuments).toHaveBeenCalledTimes(1);
		expect(scene.updateEmbeddedDocuments).toHaveBeenCalledWith("Token", [
			{ _id: a.id, hidden: true },
			{ _id: b.id, hidden: true },
		]);
	});

	it("reveals the column and its tokens again", async () => {
		config.hiddenActors = ["Actor.ogre", "Actor.other"];
		const a = placeToken(ogre, { hidden: true });

		await sidebar._toggleActorVisibility("Actor.ogre");

		expect(config.hiddenActors).toEqual(["Actor.other"]);
		expect(scene.updateEmbeddedDocuments).toHaveBeenCalledWith("Token", [
			{ _id: a.id, hidden: false },
		]);
	});

	it("leaves the tokens alone when asked to", async () => {
		placeToken(ogre);

		await sidebar._toggleActorVisibility("Actor.ogre", { syncTokens: false });

		expect(config.hiddenActors).toEqual(["Actor.ogre"]);
		expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("writes no token update for an actor with no token on the scene", async () => {
		await sidebar._toggleActorVisibility("Actor.ogre");

		expect(config.hiddenActors).toEqual(["Actor.ogre"]);
		expect(scene.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("keeps the tracked actors and limits it did not touch", async () => {
		config.limits = [{ id: "L1", label: "Doom", max: 3 }];

		await sidebar._toggleActorVisibility("Actor.ogre");

		expect(config.actors).toEqual(["Actor.ogre"]);
		expect(config.limits).toEqual([{ id: "L1", label: "Doom", max: 3 }]);
	});

	it("announces the change", async () => {
		await sidebar._toggleActorVisibility("Actor.ogre");

		expect(Sockets.dispatch).toHaveBeenCalledWith("storyTagsRender");
		expect(Hooks.callAll).toHaveBeenCalledWith("litm.sceneTagsChanged");
	});

	it("is the Narrator's to do: a player's click on the eye changes nothing", async () => {
		setPlayer();

		await action("toggle-visibility", { id: "Actor.ogre", type: "actor" });

		expect(game.settings.set).not.toHaveBeenCalled();
	});

	it("is reached through the eye on the column header", async () => {
		await action("toggle-visibility", { id: "Actor.ogre", type: "actor" });

		expect(config.hiddenActors).toEqual(["Actor.ogre"]);
	});
});

describe("removing a column", () => {
	const confirm = (answer) => {
		foundry.applications.api.DialogV2.confirm = vi
			.fn()
			.mockResolvedValue(answer);
	};

	it("is not a reveal: the actor stays on the hidden list", async () => {
		actor("ogre", "challenge");
		config = {
			actors: ["Actor.ogre", "Actor.wolf"],
			hiddenActors: ["Actor.ogre"],
			limits: [],
		};
		confirm(true);

		await action("remove-actor", { id: "Actor.ogre" });

		expect(config.actors).toEqual(["Actor.wolf"]);
		expect(config.hiddenActors).toEqual(["Actor.ogre"]);
		expect(StoryTagsStore.hiddenActorIds.has("ogre")).toBe(true);
	});

	it("removes nothing when the Narrator declines", async () => {
		actor("ogre", "challenge");
		config = { actors: ["Actor.ogre"], hiddenActors: [], limits: [] };
		confirm(false);

		await action("remove-actor", { id: "Actor.ogre" });

		expect(game.settings.set).not.toHaveBeenCalled();
	});

	it("is the Narrator's to do", async () => {
		actor("ogre", "challenge");
		config = { actors: ["Actor.ogre"], hiddenActors: [], limits: [] };
		confirm(true);
		setPlayer();

		await action("remove-actor", { id: "Actor.ogre" });

		expect(game.settings.set).not.toHaveBeenCalled();
	});
});

// A player cannot write the world pack; their Story-section edits are relayed
// to the active Narrator, whose sidebar applies them through `doUpdate`.
describe("applying a relayed Story-section write", () => {
	beforeEach(() => {
		vi.spyOn(ContentSources, "createStoryTags").mockResolvedValue([{}]);
		vi.spyOn(ContentSources, "updateStoryTags").mockResolvedValue([{}]);
		vi.spyOn(ContentSources, "deleteStoryTags").mockResolvedValue();
	});

	it.each([
		["createTags", "createStoryTags", [{ name: "fog" }]],
		["updateTags", "updateStoryTags", [{ _id: "a", name: "mist" }]],
		["deleteTags", "deleteStoryTags", ["a"]],
	])("%s writes the pack and then tells everyone", async (op, method, data) => {
		await sidebar.doUpdate(op, data);

		expect(ContentSources[method]).toHaveBeenCalledTimes(1);
		expect(ContentSources[method]).toHaveBeenCalledWith(data);
		expect(Sockets.dispatch).toHaveBeenCalledWith("storyTagsRender");
		expect(Hooks.callAll).toHaveBeenCalledWith("litm.sceneTagsChanged");
	});

	it("does nothing on a player's client", async () => {
		setPlayer();

		await sidebar.doUpdate("deleteTags", ["a"]);

		expect(ContentSources.deleteStoryTags).not.toHaveBeenCalled();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("writes nothing for an operation it does not know", async () => {
		await sidebar.doUpdate("dropPack", ["a"]);

		expect(ContentSources.createStoryTags).not.toHaveBeenCalled();
		expect(ContentSources.updateStoryTags).not.toHaveBeenCalled();
		expect(ContentSources.deleteStoryTags).not.toHaveBeenCalled();
	});
});
