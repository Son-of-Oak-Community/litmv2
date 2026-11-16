import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryTagsStore } from "../modules/apps/story-tags/story-tags-store.js";
import { pickLimit, pickTargetActor } from "../modules/apps/target-picker.js";

// The pickers an Action success opens: Advance and Set Back pick a Limit,
// opponent verbs pick an actor. A player picks from what they have been
// shown, so a Limit the Narrator has not revealed is not on the list.

const limit = (id, label, extra = {}) => ({
	id,
	label,
	value: 1,
	max: 4,
	...extra,
});

/** An actor carrying limits; `stored` are the ids in the challenge's own data. */
function withLimits(
	id,
	type,
	limits,
	{ observer = true, isOwner = false, stored } = {},
) {
	return {
		id,
		uuid: `Actor.${id}`,
		type,
		name: id,
		img: `${id}.webp`,
		isOwner,
		system: {
			limits,
			_source: {
				limits: (stored ?? limits.map((l) => l.id)).map((lid) => ({ id: lid })),
			},
		},
		testUserPermission: vi.fn(() => observer),
	};
}

/** Wire the world's actors and the sidebar's hidden columns. */
function world(actors, { hidden = [] } = {}) {
	const byUuid = new Map(actors.map((a) => [a.uuid, a]));
	foundry.utils.fromUuidSync = (uuid) => byUuid.get(uuid) ?? null;
	game.actors.contents = actors;
	game.actors.has = (id) => actors.some((a) => a.id === id);
	game.settings.get = vi.fn(() => ({
		actors: actors.map((a) => a.uuid),
		hiddenActors: hidden.map((a) => a.uuid),
		limits: [],
	}));
	StoryTagsStore.invalidateCache();
}

/** What the picker dialog listed; `pick` is the row the user confirms. */
function dialog(pick = 0) {
	const listed = [];
	vi.spyOn(
		foundry.applications.handlebars,
		"renderTemplate",
	).mockImplementation(async (_path, { entries }) => {
		listed.push(...entries);
		return "";
	});
	foundry.applications.api.DialogV2.prompt = vi.fn(async () => pick);
	return listed;
}

beforeEach(() => {
	vi.clearAllMocks();
	foundry.utils.parseUuid = () => ({ collection: {}, type: "Actor" });
	game.user = { id: "alice", isGM: false, targets: new Set() };
	game.users = [];
	game.litmv2 = {};
	globalThis.canvas = { tokens: { placeables: [] } };
	world([]);
});

afterEach(() => {
	vi.restoreAllMocks();
	StoryTagsStore.invalidateCache();
});

describe("pickLimit: which Limits are offered", () => {
	it("offers the Narrator every Limit, hidden or not", async () => {
		game.user.isGM = true;
		world([
			withLimits("Serpent", "challenge", [
				limit("L1", "Wounds", { hidden: false }),
				limit("L2", "Hunger", { hidden: true }),
			]),
		]);
		const listed = dialog(1);

		const picked = await pickLimit();

		expect(listed.map((row) => row.meta)).toEqual([
			"Wounds (1/4)",
			"Hunger (1/4)",
		]);
		expect(picked.limitId).toBe("L2");
	});

	it("names a concealed challenge by its mask", async () => {
		game.user.isGM = true;
		const serpent = withLimits("Serpent", "challenge", [
			limit("L1", "Wounds"),
			limit("L2", "Hunger"),
		]);
		serpent.system.maskedName = "Something unseen";
		world([serpent]);
		const listed = dialog(0);

		await pickLimit();

		expect(listed.map((row) => row.name)).toEqual([
			"Something unseen",
			"Something unseen",
		]);
	});
});

describe("pickLimit: where the picked Limit lives", () => {
	beforeEach(() => {
		game.user.isGM = true;
	});

	it("tells a challenge's own Limit from one an add-on contributes", async () => {
		const serpent = withLimits(
			"Serpent",
			"challenge",
			[limit("own", "Wounds"), limit("addon", "Venom")],
			{ stored: ["own"] },
		);
		world([serpent]);

		dialog(0);
		expect((await pickLimit()).source).toBe("system");
		dialog(1);
		expect((await pickLimit()).source).toBe("addon");
	});

	it("marks every other actor's Limit as flag-backed", async () => {
		world([withLimits("Gerrin", "hero", [limit("H1", "Doubt")])]);

		expect(await pickLimit()).toMatchObject({
			limitId: "H1",
			limit: { label: "Doubt" },
			source: "flag",
		});
	});

	it("returns nothing when the dialog is dismissed", async () => {
		world([
			withLimits("Serpent", "challenge", [limit("a", "A"), limit("b", "B")]),
		]);
		dialog(null);

		expect(await pickLimit()).toBeNull();
	});

	it("skips actors that carry no limits at all", async () => {
		const plain = withLimits("Rock", "story_theme", []);
		const none = withLimits("Mule", "story_theme", []);
		delete none.system.limits;
		world([plain, none]);

		expect(await pickLimit()).toBeNull();
	});
});

describe("pickTargetActor", () => {
	const actor = (id) => ({
		id,
		uuid: `Actor.${id}`,
		type: "challenge",
		name: id,
		img: `${id}.webp`,
		system: {},
	});

	it("takes the one token the user has targeted, without a dialog", async () => {
		const bandit = actor("Bandit");
		game.user.targets = new Set([{ actor: bandit }]);

		expect(await pickTargetActor()).toBe(bandit);
	});

	it("does not take a targeted token that is the rolling actor", async () => {
		const gerrin = actor("Gerrin");
		const bandit = actor("Bandit");
		world([gerrin, bandit]);
		game.user.targets = new Set([{ actor: gerrin }]);

		// Falls through to everyone in play, minus the roller: one candidate.
		expect(await pickTargetActor({ exclude: gerrin })).toBe(bandit);
	});

	it("takes a targeted roller when the verb may land on oneself", async () => {
		const gerrin = actor("Gerrin");
		game.user.targets = new Set([{ actor: gerrin }]);

		expect(await pickTargetActor({ allowSelf: true, exclude: gerrin })).toBe(
			gerrin,
		);
	});

	it("asks among several targeted tokens, leaving the roller out", async () => {
		const gerrin = actor("Gerrin");
		const bandit = actor("Bandit");
		const wolf = actor("Wolf");
		game.user.targets = new Set([
			{ actor: gerrin },
			{ actor: bandit },
			{ actor: wolf },
		]);
		const listed = dialog(1);

		const picked = await pickTargetActor({ exclude: gerrin });

		expect(listed.map((row) => row.name)).toEqual(["Bandit", "Wolf"]);
		expect(picked).toBe(wolf);
	});

	it("warns when nobody is in play", async () => {
		expect(await pickTargetActor()).toBeNull();
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Actions.no_targets_in_scene",
		);
	});
});
