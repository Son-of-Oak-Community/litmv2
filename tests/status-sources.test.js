import { describe, expect, it } from "vitest";
import { collectReducibleStatuses } from "../modules/apps/status-sources.js";

const status = (id, name, tier, extra = {}) => ({
	id,
	name,
	system: { currentTier: tier },
	...extra,
});
const actor = (id, name, statusEffects) => ({
	id,
	name,
	system: { statusEffects },
});
const candidate = (a) => ({ id: a.id, label: a.name, actor: a });

describe("collectReducibleStatuses", () => {
	it("returns the rolling actor's live statuses as the first, isOwn group", () => {
		const hero = actor("h1", "Gerrin", [
			status("e1", "wounded", 2),
			status("e2", "healed", 0),
		]);
		const groups = collectReducibleStatuses(hero, []);
		expect(groups).toEqual([
			{
				ownerId: "h1",
				ownerName: "Gerrin",
				isOwn: true,
				statuses: [{ id: "e1", name: "wounded", tier: 2 }],
			},
		]);
	});

	it("adds a group per candidate with live statuses, deduped against the rolling actor", () => {
		const hero = actor("h1", "Gerrin", [status("e1", "wounded", 2)]);
		const foe = actor("c1", "Serpent", [status("e3", "enraged", 4)]);
		const calm = actor("c2", "Rock", []);
		const groups = collectReducibleStatuses(hero, [
			candidate(hero),
			candidate(foe),
			candidate(calm),
		]);
		expect(groups).toEqual([
			{
				ownerId: "h1",
				ownerName: "Gerrin",
				isOwn: true,
				statuses: [{ id: "e1", name: "wounded", tier: 2 }],
			},
			{
				ownerId: "c1",
				ownerName: "Serpent",
				isOwn: false,
				statuses: [{ id: "e3", name: "enraged", tier: 4 }],
			},
		]);
	});

	it("omits the own group when the rolling actor has no live statuses", () => {
		const hero = actor("h1", "Gerrin", []);
		const foe = actor("c1", "Serpent", [status("e3", "enraged", 1)]);
		const groups = collectReducibleStatuses(hero, [candidate(foe)]);
		expect(groups.map((g) => g.ownerId)).toEqual(["c1"]);
	});

	it("returns [] when nothing is reducible anywhere", () => {
		const hero = actor("h1", "Gerrin", []);
		expect(collectReducibleStatuses(hero, [])).toEqual([]);
	});

	// A hidden status is a Narrator secret — the hero sheet already hides it from
	// its own owner, so the reduce picker must not be the surface that leaks it.
	it("applies statusFilter to the own group as well as candidate groups", () => {
		const hero = actor("h1", "Gerrin", [
			status("e0", "winded", 1),
			status("e1", "cursed", 2, { hiddenMark: true }),
		]);
		const foe = actor("c1", "Serpent", [
			status("e3", "enraged", 4),
			status("e4", "secretly weakened", 1, { hiddenMark: true }),
		]);
		const groups = collectReducibleStatuses(hero, [candidate(foe)], {
			statusFilter: (e) => !e.hiddenMark,
		});
		expect(groups).toEqual([
			{
				ownerId: "h1",
				ownerName: "Gerrin",
				isOwn: true,
				statuses: [{ id: "e0", name: "winded", tier: 1 }],
			},
			{
				ownerId: "c1",
				ownerName: "Serpent",
				isOwn: false,
				statuses: [{ id: "e3", name: "enraged", tier: 4 }],
			},
		]);
	});

	it("omits the own group when every own status is filtered out", () => {
		const hero = actor("h1", "Gerrin", [
			status("e1", "cursed", 2, { hiddenMark: true }),
		]);
		const groups = collectReducibleStatuses(hero, [], {
			statusFilter: (e) => !e.hiddenMark,
		});
		expect(groups).toEqual([]);
	});
});
