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

	// A pack tag is re-limited in place; an actor's tag has no pack id to update.
	it("moves an actor's tag into a Story limit by creating it there, not by updating a pack tag", async () => {
		game.user = { isGM: true, id: "gm" };
		const source = makeHero({ name: "Source" });
		actors = { [source.actor.id]: source.actor };
		const { effect, payload } = placeTag(source.actor, source.pack);

		await sidebar._onDrop(
			dropEvent(payload, { limitId: "story-lim", limitSource: "story" }),
		);

		expect(ContentSources.updateStoryTags).not.toHaveBeenCalled();
		expect(ContentSources.createStoryTags).toHaveBeenCalledTimes(1);
		const [[[created]]] = ContentSources.createStoryTags.mock.calls;
		expect(created.system.limitId).toBe("story-lim");
		expect(source.pack.deleteEmbeddedDocuments).toHaveBeenCalledWith(
			"ActiveEffect",
			[effect.id],
		);
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

// A move rebuilt the tag from its row label, which names the highest tier and
// none of the flags: a scratched tag came back whole, a hidden one visible.
// These drag from the real row and drop the real payload.

/** Start a drag on a sidebar row and return the payload it writes. */
const dragFrom = (row) => {
	const setData = vi.fn();
	sidebar._onDragStart({
		currentTarget: { closest: () => ({ dataset: row }) },
		dataTransfer: { setData },
	});
	return JSON.parse(setData.mock.calls[0][1]);
};

/** A story tag in the Story section's pack. */
const packTag = (over = {}) => {
	const { system, ...rest } = over;
	const effect = fakeEffect({
		id: "pack-tag",
		name: "fog",
		type: "story_tag",
		system: {
			isScratched: false,
			isSingleUse: false,
			isHidden: false,
			...system,
		},
		...rest,
	});
	packTags.push(effect);
	return effect;
};

describe("a moved tag keeps its state", () => {
	beforeEach(() => {
		game.user = { isGM: true, id: "gm" };
	});

	it("stays scratched on its way into the Story section", async () => {
		const source = makeHero({ name: "Source" });
		actors = { [source.actor.id]: source.actor };
		const { effect } = placeTag(source.actor, source.pack, "lantern");
		effect.system.isScratched = true;
		const payload = dragFrom({
			text: "lantern",
			id: effect.id,
			type: source.actor.id,
		});

		await sidebar._onDrop(dropEvent(payload, { column: "story" }));

		const [[[created]]] = ContentSources.createStoryTags.mock.calls;
		expect(created.system.isScratched).toBe(true);
	});

	it("stays scratched on its way back out of the Story section", async () => {
		const target = makeHero({ name: "Target" });
		actors = { [target.actor.id]: target.actor };
		const effect = packTag({ system: { isScratched: true } });
		const payload = dragFrom({ text: "fog", id: effect.id, type: "story" });

		await sidebar._onDrop(dropEvent(payload, { column: target.actor.id }));

		const [created] = target.pack.createEmbeddedDocuments.mock.calls[0][1];
		expect(created.system.isScratched).toBe(true);
	});

	it("keeps a single-use tag single-use", async () => {
		const source = makeHero({ name: "Source" });
		actors = { [source.actor.id]: source.actor };
		const { effect } = placeTag(source.actor, source.pack, "torch");
		effect.system.isSingleUse = true;
		const payload = dragFrom({
			text: "torch!",
			id: effect.id,
			type: source.actor.id,
		});

		await sidebar._onDrop(dropEvent(payload, { column: "story" }));

		const [[[created]]] = ContentSources.createStoryTags.mock.calls;
		expect(created.system.isSingleUse).toBe(true);
	});

	it("stays hidden when a Challenge's secret moves into the Story section", async () => {
		const challenge = makeChallenge();
		actors = { [challenge.id]: challenge };
		const secret = fakeEffect({
			name: "trapdoor",
			type: "story_tag",
			system: { isScratched: false, isSingleUse: false, isHidden: true },
		});
		secret.parent = challenge;
		challenge.effects.push(secret);
		const payload = dragFrom({
			text: "trapdoor",
			id: secret.id,
			type: challenge.id,
		});
		game.user = { isGM: false, id: "player" };
		game.users.activeGM = { id: "gm" };

		await sidebar._onDrop(dropEvent(payload, { column: "story" }));

		const [[, relay]] = Sockets.dispatch.mock.calls;
		expect(relay.data[0].system.isHidden).toBe(true);
	});

	it("stays hidden when a hidden Story tag moves onto a Hero", async () => {
		const target = makeHero({ name: "Target" });
		// A player's Hero would otherwise start visible for the Narrator.
		target.actor.hasPlayerOwner = true;
		actors = { [target.actor.id]: target.actor };
		const effect = packTag({ system: { isHidden: true } });
		const payload = dragFrom({ text: "fog", id: effect.id, type: "story" });

		await sidebar._onDrop(dropEvent(payload, { column: target.actor.id }));

		const [created] = target.pack.createEmbeddedDocuments.mock.calls[0][1];
		expect(created.system.isHidden).toBe(true);
	});

	it("stays visible when a visible tag moves onto a Challenge", async () => {
		const source = makeHero({ name: "Source" });
		const challenge = makeChallenge();
		actors = { [source.actor.id]: source.actor, [challenge.id]: challenge };
		const { effect } = placeTag(source.actor, source.pack, "lantern");
		const payload = dragFrom({
			text: "lantern",
			id: effect.id,
			type: source.actor.id,
		});

		await sidebar._onDrop(dropEvent(payload, { column: challenge.id }));

		const [created] = challenge.createEmbeddedDocuments.mock.calls[0][1];
		expect(created.system.isHidden).toBe(false);
	});

	it("starts hidden on a Challenge when the tag carries no state, as a chip from prose does", async () => {
		const challenge = makeChallenge();
		actors = { [challenge.id]: challenge };
		const chip = {
			id: "chip",
			name: "ambush",
			type: "story_tag",
			values: [],
			isScratched: false,
			isSingleUse: false,
		};

		await sidebar._onDrop(dropEvent(chip, { column: challenge.id }));

		const [created] = challenge.createEmbeddedDocuments.mock.calls[0][1];
		expect(created.system.isHidden).toBe(true);
	});

	it("keeps every marked tier of a stacked status", async () => {
		const source = makeChallenge();
		const target = makeChallenge();
		target.system.addStatus = vi.fn(async () => [{ id: "created" }]);
		actors = { [source.id]: source, [target.id]: target };
		const stacked = fakeEffect({
			name: "wounded",
			type: "status_tag",
			system: {
				isHidden: false,
				tiers: [true, false, true, false, false, false],
				limitId: null,
			},
		});
		stacked.parent = source;
		source.effects.push(stacked);
		const payload = dragFrom({
			text: "wounded-3",
			id: stacked.id,
			type: source.id,
		});

		await sidebar._onDrop(dropEvent(payload, { column: target.id }));

		const [, options] = target.system.addStatus.mock.calls[0];
		expect(options.tiers.slice(0, 4)).toEqual([true, false, true, false]);
		expect(source.deleteEmbeddedDocuments).toHaveBeenCalledWith(
			"ActiveEffect",
			[stacked.id],
		);
	});

	it("does not carry the source's limit link to a column that has no such limit", async () => {
		const source = makeChallenge();
		const target = makeChallenge();
		target.system.addStatus = vi.fn(async () => [{ id: "created" }]);
		actors = { [source.id]: source, [target.id]: target };
		const linked = fakeEffect({
			name: "wounded",
			type: "status_tag",
			system: {
				isHidden: false,
				tiers: [false, true, false, false, false, false],
				limitId: "source-limit",
			},
		});
		linked.parent = source;
		source.effects.push(linked);
		const payload = dragFrom({
			text: "wounded-2",
			id: linked.id,
			type: source.id,
		});

		await sidebar._onDrop(dropEvent(payload, { column: target.id }));

		const [, options] = target.system.addStatus.mock.calls[0];
		expect(options.limitId).toBeUndefined();
	});
});

// New tags are not moves: they carry no hidden flag of their own, so the
// column's owner decides, as before.
describe("a tag the Narrator adds", () => {
	beforeEach(() => {
		game.user = { isGM: true, id: "gm" };
	});

	it("starts visible on a player's Hero", async () => {
		const hero = makeHero({ name: "Hero" });
		hero.actor.hasPlayerOwner = true;
		actors = { [hero.actor.id]: hero.actor };

		await sidebar.addTag(hero.actor.id);

		const [created] = hero.pack.createEmbeddedDocuments.mock.calls[0][1];
		expect(created.system.isHidden).toBe(false);
	});

	it("starts hidden on a Challenge", async () => {
		const challenge = makeChallenge();
		actors = { [challenge.id]: challenge };

		await sidebar.addTag(challenge.id);

		const [created] = challenge.createEmbeddedDocuments.mock.calls[0][1];
		expect(created.system.isHidden).toBe(true);
	});
});
