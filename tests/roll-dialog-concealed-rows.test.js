import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LitmRollDialog } from "../modules/apps/roll/roll-dialog.js";
import { StoryTagsStore } from "../modules/apps/story-tags/story-tags-store.js";

// roll-dialog.js `#buildConcealedRows`, reached through the render context
// (`concealedTags`): "Rows for selections that count toward Power but have no
// rendered row on this client... Concealment is the GM's deliberate feature, so
// the row is masked rather than revealed: no name, no actor, but the type and
// the tier — which is the part that moves the total. The GM builds none of
// these: they can see every row already." CLAUDE.md: "Invocations the roller
// can't see — a concealed Challenge's tags, say — still count toward Power, so
// the dialog renders them as masked rows ('Something unseen', tier intact, no
// name, no actor)." and "A hidden tag or status is never shown to the player it
// is hidden from, on any surface".

const FELLOWSHIP = "fellowship";
const SECRET = "The king is a vampire";
const UUID = "Actor.foe.ActiveEffect.secret";

let effects;
let config;
let actors;
let foe;

const effect = (
	uuid,
	{ name = SECRET, type = "status_tag", tier = 4 } = {},
) => {
	effects.set(uuid, {
		_id: uuid,
		id: uuid,
		uuid,
		name,
		type,
		system: { currentTier: tier },
	});
	return uuid;
};

const as = (id, isGM) => {
	game.user = { id, isGM, character: null };
};
const dialogFor = (actorId, ownerId) => {
	const dialog = new LitmRollDialog({
		actorId,
		ownerId,
		speaker: {},
	});
	dialog.tabGroups = {};
	return dialog;
};

beforeEach(() => {
	effects = new Map();
	actors = new Map();
	config = { actors: ["Actor.foe"], hiddenActors: ["Actor.foe"] };
	as("player", false);
	game.packs = { get: () => null };
	game.users.filter = () => [];
	game.litmv2 = { fellowship: { id: FELLOWSHIP, name: "Fellowship" } };
	actors.set(FELLOWSHIP, {
		id: FELLOWSHIP,
		uuid: `Actor.${FELLOWSHIP}`,
		name: "Fellowship",
		type: "fellowship",
		appliedEffects: [],
		items: [],
		system: {},
		testUserPermission: () => true,
	});
	game.actors.get.mockImplementation((id) => actors.get(id) ?? null);
	game.settings.get.mockImplementation((_scope, key) =>
		key === "storytags" ? config : undefined,
	);
	foe = {
		id: "foe",
		uuid: "Actor.foe",
		documentName: "Actor",
		type: "challenge",
		name: "The Vampire King",
		img: "foe.webp",
		isOwner: false,
		prototypeToken: { texture: { src: "" } },
		appliedEffects: [],
		system: {
			maskedName: "Something in the dark",
			storyTags: [],
			statusEffects: [],
		},
	};
	foundry.utils.parseUuid = (uuid) => ({
		collection: "Actor",
		type: uuid?.startsWith("Actor.") ? "Actor" : null,
	});
	foundry.utils.fromUuidSync.mockImplementation((uuid) => {
		if (uuid === "Actor.foe") return foe;
		return effects.get(uuid) ?? null;
	});
	StoryTagsStore.invalidateCache();
});
afterEach(() => {
	StoryTagsStore.invalidateCache();
	vi.restoreAllMocks();
	game.actors.get.mockReset();
	game.settings.get.mockReset();
	foundry.utils.fromUuidSync.mockReset();
	delete game.users.filter;
	delete foundry.utils.parseUuid;
});

const SHAPES = [
	["an Acting Together roll", { actorId: FELLOWSHIP, ownerId: "gm" }],
	["a single Hero's roll", { actorId: "hero", ownerId: "player" }],
];

/** The render context for `viewer`, after the Narrator invoked `picks`. */
const contextFor = async (shape, picks, { isGM = false } = {}) => {
	game.litmv2 = {
		fellowship:
			shape.actorId === FELLOWSHIP
				? { id: FELLOWSHIP, name: "Fellowship" }
				: null,
	};
	as(isGM ? "gm" : "player", isGM);
	const ownerId = isGM ? "gm" : shape.ownerId;
	const dialog = dialogFor(shape.actorId, ownerId);
	for (const [uuid, state, meta] of picks)
		dialog.setSelection(uuid, state, "gm", meta);
	return dialog._prepareContext({});
};
const narratorPick = (uuid = UUID, state = "negative") => [
	uuid,
	state,
	{ narrator: true },
];

describe.each(SHAPES)("masked rows in %s", (_label, shape) => {
	beforeEach(() => {
		actors.set("hero", {
			id: "hero",
			uuid: "Actor.hero",
			name: "Hero",
			type: "hero",
			img: "hero.webp",
			items: [],
			appliedEffects: [],
			system: {
				statusEffects: [],
				storyTags: [],
				themes: [],
				storyThemes: [],
				fellowship: { tags: [], themes: [] },
				relationships: [],
			},
		});
	});

	it("stands in for a concealed Challenge's invocation: its type and tier, no name, no actor", async () => {
		effect(UUID);
		const context = await contextFor(shape, [narratorPick()]);
		expect(context.concealedTags).toEqual([
			{
				key: UUID,
				type: "status_tag",
				displayName: "LITM.Ui.roll_concealed_tag",
				state: "negative",
				value: 4,
				// One state, so the checkbox can still show the polarity.
				states: "negative",
				locked: true,
				isNarrator: true,
			},
		]);
	});

	it.each([1, 3, 6])(
		"keeps the tier the Power counts (tier %i)",
		async (tier) => {
			effect(UUID, { tier });
			const context = await contextFor(shape, [narratorPick()]);
			expect(context.concealedTags[0].value).toBe(tier);
		},
	);

	it("never says what the tag, its Challenge or its alias is, anywhere in the context", async () => {
		effect(UUID);
		const context = await contextFor(shape, [narratorPick()]);
		const everything = JSON.stringify(context);
		expect(everything).not.toContain(SECRET);
		expect(everything).not.toContain("The Vampire King");
		expect(everything).not.toContain("Something in the dark");
	});

	it("still lets the tag count toward the total the player sees", async () => {
		effect(UUID, { tier: 4 });
		const context = await contextFor(shape, [narratorPick()]);
		expect(context.totalPower).toBe(-4);
	});

	it("gives a tier-less tag no tier, and marks a pick that is not the Narrator's", async () => {
		effect(UUID, { type: "story_tag" });
		const context = await contextFor(shape, [[UUID, "positive"]]);
		expect(context.concealedTags).toHaveLength(1);
		expect(context.concealedTags[0]).toMatchObject({
			type: "story_tag",
			state: "positive",
			isNarrator: false,
		});
		expect(context.concealedTags[0].value).toBeUndefined();
	});

	it("makes one row per concealed pick, in the order they were picked", async () => {
		const second = "Actor.foe.ActiveEffect.second";
		effect(UUID, { tier: 2 });
		effect(second, { name: "Hungry", tier: 5 });
		const context = await contextFor(shape, [
			narratorPick(second, "negative"),
			narratorPick(UUID, "negative"),
		]);
		expect(context.concealedTags.map((row) => [row.key, row.value])).toEqual([
			[second, 5],
			[UUID, 2],
		]);
	});

	it("makes none for a pick that no longer resolves, which counts for nothing", async () => {
		const context = await contextFor(shape, [narratorPick()]);
		expect(context.concealedTags).toEqual([]);
		expect(context.totalPower).toBe(0);
	});

	it("makes none for the Narrator, who sees every row already", async () => {
		effect(UUID);
		const context = await contextFor(shape, [narratorPick()], { isGM: true });
		expect(context.concealedTags).toEqual([]);
		expect(context.totalPower).toBe(-4);
	});

	it("makes none once the column is revealed, because the real row is on screen", async () => {
		effect(UUID);
		const secret = effects.get(UUID);
		Object.assign(secret, {
			active: true,
			parent: { id: "th", name: "Dread" },
		});
		secret.system.isHidden = false;
		foe.appliedEffects = [secret];
		foe.system.statusEffects = [secret];
		config = { actors: ["Actor.foe"], hiddenActors: [] };
		StoryTagsStore.invalidateCache();

		const context = await contextFor(shape, [narratorPick()]);
		expect(context.concealedTags).toEqual([]);
		// The row is shown in the open, not dropped.
		expect(JSON.stringify(context)).toContain(SECRET);
		expect(context.totalPower).toBe(-4);
	});
});
