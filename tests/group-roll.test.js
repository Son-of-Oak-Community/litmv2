import { describe, expect, it } from "vitest";
import { findBurnedSelection } from "../modules/apps/roll/burn-cap.js";
import {
	findHeroTagConflict,
	resolveGroupParticipants,
} from "../modules/apps/roll/group-roll.js";

/**
 * Acting Together, Core Book p.157: one roll for the group, one tag from each
 * participating Hero, one burn across the whole thing, and any or all of the
 * Fellowship theme's power tags on top.
 */

const heroes = [{ id: "h1" }, { id: "h2" }, { id: "h3" }];

describe("resolveGroupParticipants", () => {
	it("keeps hero order rather than pick order", () => {
		expect(
			resolveGroupParticipants({ heroes, selectedIds: ["h3", "h1"] }),
		).toEqual(["h1", "h3"]);
	});

	it("drops ids that aren't heroes", () => {
		expect(
			resolveGroupParticipants({ heroes, selectedIds: ["h1", "not-a-hero"] }),
		).toEqual(["h1"]);
	});

	it("collapses duplicates", () => {
		expect(
			resolveGroupParticipants({ heroes, selectedIds: ["h2", "h2"] }),
		).toEqual(["h2"]);
	});

	it("keeps an offline participant in the roll — they simply contribute no tag", () => {
		const withPresence = [
			{ id: "h1", online: true },
			{ id: "h2", online: false },
		];
		expect(
			resolveGroupParticipants({
				heroes: withPresence,
				selectedIds: ["h1", "h2"],
			}),
		).toEqual(["h1", "h2"]);
	});

	it("returns nothing when the Narrator picked nobody", () => {
		expect(resolveGroupParticipants({ heroes })).toEqual([]);
		expect(resolveGroupParticipants()).toEqual([]);
	});
});

describe("findHeroTagConflict", () => {
	const participantIds = ["h1", "h2"];
	const entries = (...pairs) => new Map(pairs);

	it("refuses a Hero's second tag", () => {
		const map = entries(["tag-a", { state: "positive", tagActorId: "h1" }]);
		expect(
			findHeroTagConflict(map, {
				tagActorId: "h1",
				uuid: "tag-b",
				participantIds,
			}),
		).toBe("tag-a");
	});

	it("lets a Hero re-cycle the tag they already picked", () => {
		const map = entries(["tag-a", { state: "positive", tagActorId: "h1" }]);
		expect(
			findHeroTagConflict(map, {
				tagActorId: "h1",
				uuid: "tag-a",
				participantIds,
			}),
		).toBe(null);
	});

	it("counts a relationship tag against the Hero's one, since it lives on them", () => {
		const map = entries(["rel-tag", { state: "positive", tagActorId: "h1" }]);
		expect(
			findHeroTagConflict(map, {
				tagActorId: "h1",
				uuid: "theme-tag",
				participantIds,
			}),
		).toBe("rel-tag");
	});

	it("does not cap a different Hero", () => {
		const map = entries(["tag-a", { state: "positive", tagActorId: "h1" }]);
		expect(
			findHeroTagConflict(map, {
				tagActorId: "h2",
				uuid: "tag-b",
				participantIds,
			}),
		).toBe(null);
	});

	it("exempts Fellowship theme tags — any or all of them may be invoked", () => {
		const map = entries(
			["fel-1", { state: "positive", tagActorId: "fellowship" }],
			["fel-2", { state: "positive", tagActorId: "fellowship" }],
		);
		expect(
			findHeroTagConflict(map, {
				tagActorId: "fellowship",
				uuid: "fel-3",
				participantIds,
			}),
		).toBe(null);
	});

	it("exempts scene and opposition tags, which belong to no participant", () => {
		const map = entries(["scene", { state: "negative", tagActorId: null }]);
		expect(
			findHeroTagConflict(map, {
				tagActorId: null,
				uuid: "another-scene-tag",
				participantIds,
			}),
		).toBe(null);
	});

	it("ignores a Hero's deselected tag — an empty state is not a contribution", () => {
		const map = entries(["tag-a", { state: "", tagActorId: "h1" }]);
		expect(
			findHeroTagConflict(map, {
				tagActorId: "h1",
				uuid: "tag-b",
				participantIds,
			}),
		).toBe(null);
	});

	it("does not cap a Hero who is not in the roll", () => {
		const map = entries(["tag-a", { state: "positive", tagActorId: "h9" }]);
		expect(
			findHeroTagConflict(map, {
				tagActorId: "h9",
				uuid: "tag-b",
				participantIds,
			}),
		).toBe(null);
	});
});

describe("the group burn cap needs no group-specific code", () => {
	/**
	 * One Hero may burn a tag for the whole roll (p.157). `findBurnedSelection`
	 * already caps the entire selection map at one scratched tag, so a burn on
	 * one participant blocks a burn on another for free. These pin that.
	 */
	it("blocks a second Hero from burning once one has", () => {
		const map = new Map([
			["h1-tag", { state: "scratched", tagActorId: "h1" }],
			["h2-tag", { state: "positive", tagActorId: "h2" }],
		]);
		expect(findBurnedSelection(map, "h2-tag")).toBe("h1-tag");
	});

	it("lets the burning Hero change their own burn", () => {
		const map = new Map([["h1-tag", { state: "scratched", tagActorId: "h1" }]]);
		expect(findBurnedSelection(map, "h1-tag")).toBe(null);
	});

	it("allows the first burn in a group roll", () => {
		const map = new Map([
			["h1-tag", { state: "positive", tagActorId: "h1" }],
			["h2-tag", { state: "negative", tagActorId: "h2" }],
		]);
		expect(findBurnedSelection(map, "h3-tag")).toBe(null);
	});
});
