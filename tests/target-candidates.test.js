import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoryTagsStore } from "../modules/apps/story-tags/story-tags-store.js";
import { getTargetCandidates } from "../modules/apps/target-picker.js";

/**
 * Targetable actors are "who is in play": scene tokens plus the story-tag
 * sidebar's tracked actors. The world actor directory is NOT a source — a
 * content module's story-theme library would otherwise flood every picker.
 *
 * Which *types* are targetable stays a per-call-site policy (Apply Consequences
 * narrows to the player side; Spend Power's pickers don't) — the `types` test
 * below asserts the filter works, not which set any caller should pass.
 */

const makeActor = (id, type, extra = {}) => ({
	id,
	uuid: `Actor.${id}`,
	type,
	name: id,
	img: `${id}.webp`,
	documentName: "Actor",
	system: {},
	...extra,
});

const makeToken = (actor, { src = `${actor.id}-token.webp`, hidden } = {}) => ({
	actor,
	document: { texture: { src }, hidden },
});

/** Wire the store's tracked-actor set from a list of stub actors. */
function trackActors(actors, { hidden = [] } = {}) {
	const byUuid = new Map(actors.map((a) => [a.uuid, a]));
	foundry.utils.fromUuidSync = (uuid) => byUuid.get(uuid) ?? null;
	game.settings.get = vi.fn(() => ({
		actors: actors.map((a) => a.uuid),
		hiddenActors: hidden.map((a) => a.uuid),
		limits: [],
	}));
	StoryTagsStore.invalidateCache();
}

describe("getTargetCandidates", () => {
	let catalog;

	beforeEach(() => {
		// Pass UUIDs through normalizeConfig unchanged.
		foundry.utils.parseUuid = () => ({ collection: {}, type: "Actor" });
		game.user = { isGM: true };
		game.users = [];
		game.litmv2 = {};
		globalThis.canvas = { tokens: { placeables: [] } };

		// A content module's story-theme library sitting in the world directory.
		catalog = [
			makeActor("Farm Mule", "story_theme"),
			makeActor("Hive of Bees", "story_theme"),
			makeActor("Untracked Hero", "hero"),
		];
		game.actors.contents = catalog;
		game.actors.has = (id) => catalog.some((a) => a.id === id);
		StoryTagsStore.invalidateCache();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		StoryTagsStore.invalidateCache();
	});

	it("does not offer untracked world actors when the scene has no tokens", () => {
		const gerrin = makeActor("Gerrin", "hero");
		trackActors([gerrin]);

		const ids = getTargetCandidates().map((c) => c.id);
		expect(ids).toEqual(["Gerrin"]);
	});

	it("still offers tracked actors that have no token when tokens exist", () => {
		const wolves = makeActor("Wolves", "challenge");
		const fellowship = makeActor("Fellowship", "fellowship");
		trackActors([fellowship]);
		canvas.tokens.placeables = [makeToken(wolves)];

		const ids = getTargetCandidates().map((c) => c.id);
		expect(ids).toContain("Wolves");
		expect(ids).toContain("Fellowship");
	});

	it("dedupes an actor that is both tracked and on canvas", () => {
		const gerrin = makeActor("Gerrin", "hero");
		trackActors([gerrin]);
		canvas.tokens.placeables = [makeToken(gerrin)];

		const candidates = getTargetCandidates();
		expect(candidates).toHaveLength(1);
		expect(candidates[0].img).toBe("Gerrin.webp");
	});

	it("falls back to token art for an actor with no portrait", () => {
		const gerrin = makeActor("Gerrin", "hero", { img: null });
		trackActors([gerrin]);
		canvas.tokens.placeables = [makeToken(gerrin)];

		expect(getTargetCandidates()[0].img).toBe("Gerrin-token.webp");
	});

	it("hides a sidebar-hidden actor that also has a token on the scene", () => {
		const gerrin = makeActor("Gerrin", "hero");
		const lurker = makeActor("Lurker", "challenge");
		trackActors([gerrin, lurker], { hidden: [lurker] });
		// The token source runs first, so a hidden column whose actor is also on
		// the canvas must not slip in ahead of the visibility check.
		canvas.tokens.placeables = [makeToken(lurker)];

		game.user = { isGM: false };
		StoryTagsStore.invalidateCache();
		expect(getTargetCandidates().map((c) => c.id)).toEqual(["Gerrin"]);
	});

	it("hides GM-hidden tokens from players but not from the GM", () => {
		const gerrin = makeActor("Gerrin", "hero");
		const ambush = makeActor("Ambush", "challenge");
		trackActors([gerrin]);
		canvas.tokens.placeables = [makeToken(ambush, { hidden: true })];

		expect(getTargetCandidates().map((c) => c.id)).toContain("Ambush");

		game.user = { isGM: false };
		StoryTagsStore.invalidateCache();
		expect(getTargetCandidates().map((c) => c.id)).not.toContain("Ambush");
	});

	it("hides sidebar-hidden actors from players but not from the GM", () => {
		const gerrin = makeActor("Gerrin", "hero");
		const lurker = makeActor("Lurker", "challenge");
		trackActors([gerrin, lurker], { hidden: [lurker] });

		expect(getTargetCandidates().map((c) => c.id)).toContain("Lurker");

		game.user = { isGM: false };
		StoryTagsStore.invalidateCache();
		expect(getTargetCandidates().map((c) => c.id)).not.toContain("Lurker");
	});

	it("applies the type filter to tokens and tracked actors alike", () => {
		const wolves = makeActor("Wolves", "challenge");
		const theme = makeActor("Blood Feud", "story_theme");
		trackActors([theme]);
		canvas.tokens.placeables = [makeToken(wolves)];

		const ids = getTargetCandidates({ types: ["story_theme"] }).map(
			(c) => c.id,
		);
		expect(ids).toEqual(["Blood Feud"]);
	});

	it("excludes the rolling actor unless allowSelf", () => {
		const gerrin = makeActor("Gerrin", "hero");
		const bogomil = makeActor("Bogomil", "hero");
		trackActors([gerrin, bogomil]);

		expect(getTargetCandidates({ exclude: gerrin }).map((c) => c.id)).toEqual([
			"Bogomil",
		]);
		expect(
			getTargetCandidates({ allowSelf: true, exclude: gerrin }).map(
				(c) => c.id,
			),
		).toContain("Gerrin");
	});

	it("prefers a concealed challenge's masked name", () => {
		const lurker = makeActor("Lurker", "challenge", {
			system: { maskedName: "Something Stirs" },
		});
		trackActors([lurker]);

		expect(getTargetCandidates()[0].label).toBe("Something Stirs");
	});
});
