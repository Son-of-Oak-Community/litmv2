import { describe, expect, it } from "vitest";
import { collectScratchableTags } from "../modules/apps/scratch-sources.js";

const tag = (id, name, isScratched = false) => ({
	id,
	name,
	system: { isScratched },
});
const actor = (id, name, storyTags) => ({ id, name, system: { storyTags } });
const candidate = (a) => ({ id: a.id, label: a.name, actor: a });

describe("collectScratchableTags", () => {
	it("returns the rolling actor's unscratched story tags as the first, isOwn group", () => {
		const hero = actor("h1", "Gerrin", [
			tag("e1", "tonic"),
			tag("e2", "rope", true),
		]);
		const groups = collectScratchableTags(hero, []);
		expect(groups).toEqual([
			{
				ownerId: "h1",
				ownerName: "Gerrin",
				isOwn: true,
				tags: [{ id: "e1", name: "tonic" }],
			},
		]);
	});

	it("adds a group per candidate that has unscratched story tags, deduped against the rolling actor", () => {
		const hero = actor("h1", "Gerrin", [tag("e1", "tonic")]);
		const foe = actor("c1", "Bandit", [tag("e3", "reinforcements")]);
		const empty = actor("c2", "Rock", []);
		const groups = collectScratchableTags(hero, [
			candidate(hero),
			candidate(foe),
			candidate(empty),
		]);
		expect(groups).toEqual([
			{
				ownerId: "h1",
				ownerName: "Gerrin",
				isOwn: true,
				tags: [{ id: "e1", name: "tonic" }],
			},
			{
				ownerId: "c1",
				ownerName: "Bandit",
				isOwn: false,
				tags: [{ id: "e3", name: "reinforcements" }],
			},
		]);
	});

	it("omits the own group when the rolling actor has no unscratched story tags", () => {
		const hero = actor("h1", "Gerrin", [tag("e2", "rope", true)]);
		const foe = actor("c1", "Bandit", [tag("e3", "reinforcements")]);
		const groups = collectScratchableTags(hero, [candidate(foe)]);
		expect(groups).toEqual([
			{
				ownerId: "c1",
				ownerName: "Bandit",
				isOwn: false,
				tags: [{ id: "e3", name: "reinforcements" }],
			},
		]);
	});

	it("returns [] when nothing is scratchable anywhere", () => {
		const hero = actor("h1", "Gerrin", []);
		expect(collectScratchableTags(hero, [])).toEqual([]);
	});

	it("appends a flagged scene group (isScene) when scene story tags are given", () => {
		const hero = actor("h1", "Gerrin", [tag("e1", "tonic")]);
		const sceneTags = [
			{ id: "s1", name: "alarm raised" },
			{ id: "s2", name: "burning bridge" },
		];
		const groups = collectScratchableTags(hero, [], sceneTags);
		expect(groups).toEqual([
			{
				ownerId: "h1",
				ownerName: "Gerrin",
				isOwn: true,
				tags: [{ id: "e1", name: "tonic" }],
			},
			{
				ownerId: "",
				ownerName: "",
				isOwn: false,
				isScene: true,
				tags: [
					{ id: "s1", name: "alarm raised" },
					{ id: "s2", name: "burning bridge" },
				],
			},
		]);
	});

	it("omits the scene group when no scene tags are provided", () => {
		const hero = actor("h1", "Gerrin", [tag("e1", "tonic")]);
		const groups = collectScratchableTags(hero, []);
		expect(groups.some((g) => g.isScene)).toBe(false);
	});

	it("can produce a scene-only picker (no actor tags)", () => {
		const hero = actor("h1", "Gerrin", []);
		const groups = collectScratchableTags(
			hero,
			[],
			[{ id: "s1", name: "fog" }],
		);
		expect(groups).toEqual([
			{
				ownerId: "",
				ownerName: "",
				isOwn: false,
				isScene: true,
				tags: [{ id: "s1", name: "fog" }],
			},
		]);
	});
});
