import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryTagSidebar } from "../modules/apps/story-tags/story-tag-sidebar.js";
import { HeroData } from "../modules/actor/hero/hero-data.js";
import { LitmConfig } from "../modules/system/config.js";
import { ContentSources } from "../modules/system/content-sources.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

// Dragging a tag between columns is a move: add it to the destination, then
// remove it from the source. The audit found the second half ran whether or not
// the first happened, so a refused drop (not the owner, no backpack, no
// Narrator to relay a Story write) deleted the tag from where it was. These
// drive the real sidebar through its drop handler, `_onDrop`.

const original = CONFIG.litmv2;
const originalUser = game.user;
const originalActors = game.actors;
const originalPacks = game.packs;
const originalUsers = game.users;

/** A hero with a backpack, whose model is the real HeroData. */
const makeHero = ({ name = "Hero", isOwner = true, backpack = true } = {}) => {
	const pack = backpack ? fakeItem({ type: "backpack" }) : null;
	const actor = fakeActor({
		name,
		type: "hero",
		isOwner,
		items: pack ? [pack] : [],
	});
	const model = new HeroData();
	model.parent = actor;
	actor.system = model;
	Object.defineProperty(model, "backpackItem", { get: () => pack });
	model.recalculateLimitValues = vi.fn();
	if (pack) pack.createEmbeddedDocuments.mockResolvedValue([{ id: "created" }]);
	return { actor, pack };
};

/** A challenge-style actor: story tags are created on the actor itself. */
const makeChallenge = ({ isOwner = true } = {}) => {
	const actor = fakeActor({ name: "Ogre", type: "challenge", isOwner });
	actor.createEmbeddedDocuments.mockResolvedValue([{ id: "created" }]);
	actor.system = {
		addStoryTag: vi.fn(async (data) =>
			actor.createEmbeddedDocuments("ActiveEffect", [data]),
		),
		recalculateLimitValues: vi.fn(),
	};
	return actor;
};

/** A story tag living in `container`'s backpack, as the sidebar row names it. */
const placeTag = (actor, pack, name = "lantern") => {
	const effect = fakeEffect({
		name,
		type: "story_tag",
		system: { isScratched: false, isSingleUse: false, isHidden: false },
	});
	effect.parent = pack;
	effect.transfer = true;
	pack.effects.push(effect);
	return { effect, payload: payloadFor(effect, actor.id) };
};

const payloadFor = (effect, container) => ({
	id: "drag-id",
	name: effect.name,
	type: effect.type,
	values: [],
	isScratched: false,
	isSingleUse: false,
	sourceId: effect.id,
	sourceContainer: container,
});

/**
 * A drop event: `data` is the dragged payload, `column` is the container the
 * pointer ended up over (an actor id, or "story"), `limitId`/`limitSource` set
 * when it landed on a limit header.
 */
const dropEvent = (data, { column, limitId, limitSource } = {}) => ({
	dataTransfer: { getData: () => JSON.stringify(data) },
	target: {
		closest: (selector) => {
			if (selector === "[data-limit-id]" && limitId) {
				return { dataset: { limitId, source: limitSource } };
			}
			if (selector === "[data-id]" && column)
				return { dataset: { id: column } };
			return null;
		},
	},
});

let sidebar;
let actors;
let packTags;

beforeEach(() => {
	vi.clearAllMocks();
	CONFIG.litmv2 = Object.create(LitmConfig);
	CONFIG.litmv2.heroLimit = 5;
	CONFIG.litmv2._maxStatusTierOverride = null;
	game.user = { isGM: false, id: "player" };
	game.users = { activeGM: null, get: vi.fn() };
	actors = {};
	packTags = [];
	game.actors = { get: (id) => actors[id] ?? null };
	game.packs = { get: () => ({ contents: packTags }) };
	sidebar = new StoryTagSidebar();
	sidebar.render = vi.fn();
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
	vi.spyOn(ContentSources, "createStoryTags").mockResolvedValue([{}]);
	vi.spyOn(ContentSources, "updateStoryTags").mockResolvedValue([{}]);
	vi.spyOn(ContentSources, "deleteStoryTags").mockResolvedValue();
});

afterEach(() => {
	vi.restoreAllMocks();
	CONFIG.litmv2 = original;
	game.user = originalUser;
	game.users = originalUsers;
	game.actors = originalActors;
	game.packs = originalPacks;
});

const storyRelays = (operation) =>
	Sockets.dispatch.mock.calls.filter(
		([event, body]) =>
			event === "storyTagsUpdate" && body.operation === operation,
	);

describe("dropping a tag onto another actor's column", () => {
	it("moves it: the destination gets the tag and the source loses it", async () => {
		const source = makeHero({ name: "Source" });
		const target = makeHero({ name: "Target" });
		actors = {
			[source.actor.id]: source.actor,
			[target.actor.id]: target.actor,
		};
		const { effect, payload } = placeTag(source.actor, source.pack);

		await sidebar._onDrop(dropEvent(payload, { column: target.actor.id }));

		expect(target.pack.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
		expect(source.pack.deleteEmbeddedDocuments).toHaveBeenCalledWith(
			"ActiveEffect",
			[effect.id],
		);
	});

	it("keeps the tag where it was when the target is not the player's to edit", async () => {
		const source = makeHero({ name: "Source" });
		const target = makeChallenge({ isOwner: false });
		actors = { [source.actor.id]: source.actor, [target.id]: target };
		const { payload } = placeTag(source.actor, source.pack);

		await sidebar._onDrop(dropEvent(payload, { column: target.id }));

		expect(ui.notifications.error).toHaveBeenCalledWith(
			"LITM.Ui.warn_not_owner",
			{ localize: true },
		);
		expect(target.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(source.pack.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("keeps the tag where it was when the target Hero has no backpack", async () => {
		const source = makeHero({ name: "Source" });
		const target = makeHero({ name: "Target", backpack: false });
		actors = {
			[source.actor.id]: source.actor,
			[target.actor.id]: target.actor,
		};
		const { payload } = placeTag(source.actor, source.pack);

		await sidebar._onDrop(dropEvent(payload, { column: target.actor.id }));

		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.warn_no_backpack",
		);
		expect(source.pack.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("keeps the tag where it was when the target no longer exists", async () => {
		const source = makeHero({ name: "Source" });
		actors = { [source.actor.id]: source.actor };
		const { payload } = placeTag(source.actor, source.pack);

		await sidebar._onDrop(dropEvent(payload, { column: "gone" }));

		expect(ui.notifications.error).toHaveBeenCalledWith(
			"LITM.Ui.error_no_actor",
			{
				localize: true,
			},
		);
		expect(source.pack.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("keeps the tag where it was when the create was cancelled", async () => {
		const source = makeHero({ name: "Source" });
		const target = makeChallenge();
		target.createEmbeddedDocuments.mockResolvedValue([]);
		actors = { [source.actor.id]: source.actor, [target.id]: target };
		const { payload } = placeTag(source.actor, source.pack);

		await sidebar._onDrop(dropEvent(payload, { column: target.id }));

		expect(source.pack.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

describe("dropping a tag into the Story section", () => {
	it("moves it for the Narrator", async () => {
		game.user = { isGM: true, id: "gm" };
		const source = makeHero({ name: "Source" });
		actors = { [source.actor.id]: source.actor };
		const { effect, payload } = placeTag(source.actor, source.pack);

		await sidebar._onDrop(dropEvent(payload, { column: "story" }));

		expect(ContentSources.createStoryTags).toHaveBeenCalledTimes(1);
		expect(source.pack.deleteEmbeddedDocuments).toHaveBeenCalledWith(
			"ActiveEffect",
			[effect.id],
		);
	});

	it("relays the create to the active Narrator for a player", async () => {
		game.users.activeGM = { id: "gm" };
		const source = makeHero({ name: "Source" });
		actors = { [source.actor.id]: source.actor };
		const { effect, payload } = placeTag(source.actor, source.pack);

		await sidebar._onDrop(dropEvent(payload, { column: "story" }));

		expect(storyRelays("createTags")).toHaveLength(1);
		expect(source.pack.deleteEmbeddedDocuments).toHaveBeenCalledWith(
			"ActiveEffect",
			[effect.id],
		);
	});

	it("moves nothing for a player when no Narrator is online to receive it", async () => {
		const source = makeHero({ name: "Source" });
		actors = { [source.actor.id]: source.actor };
		const { payload } = placeTag(source.actor, source.pack);

		await sidebar._onDrop(dropEvent(payload, { column: "story" }));

		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.story_tags_need_narrator",
			{ localize: true },
		);
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(source.pack.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("moves nothing for a player taking a Story tag when no Narrator can remove it", async () => {
		const target = makeHero({ name: "Target" });
		actors = { [target.actor.id]: target.actor };
		const payload = {
			id: "drag-id",
			name: "fog",
			type: "story_tag",
			values: [],
			sourceId: "pack-tag",
			sourceContainer: "story",
		};

		await sidebar._onDrop(dropEvent(payload, { column: target.actor.id }));

		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.story_tags_need_narrator",
			{ localize: true },
		);
		expect(target.pack.createEmbeddedDocuments).not.toHaveBeenCalled();
	});
});

describe("dropping a tag onto a limit header", () => {
	it("keeps the tag where it was when the target Hero has no backpack", async () => {
		const source = makeHero({ name: "Source" });
		const target = makeHero({ name: "Target", backpack: false });
		actors = {
			[source.actor.id]: source.actor,
			[target.actor.id]: target.actor,
		};
		const { payload } = placeTag(source.actor, source.pack);

		await sidebar._onDrop(
			dropEvent(payload, { limitId: "lim-1", limitSource: target.actor.id }),
		);

		expect(source.pack.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("keeps an actor's tag where it was when no Narrator is online for a Story limit", async () => {
		const source = makeHero({ name: "Source" });
		actors = { [source.actor.id]: source.actor };
		const { payload } = placeTag(source.actor, source.pack);

		await sidebar._onDrop(
			dropEvent(payload, { limitId: "story-lim", limitSource: "story" }),
		);

		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.story_tags_need_narrator",
			{ localize: true },
		);
		expect(source.pack.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("still re-limits a Story tag by updating it in the pack", async () => {
		game.user = { isGM: true, id: "gm" };
		const payload = {
			id: "drag-id",
			name: "fog",
			type: "story_tag",
			values: [],
			sourceId: "pack-tag",
			sourceContainer: "story",
		};

		await sidebar._onDrop(
			dropEvent(payload, { limitId: "story-lim", limitSource: "story" }),
		);

		expect(ContentSources.updateStoryTags).toHaveBeenCalledWith([
			{ _id: "pack-tag", "system.limitId": "story-lim" },
		]);
		expect(ContentSources.createStoryTags).not.toHaveBeenCalled();
	});
});
