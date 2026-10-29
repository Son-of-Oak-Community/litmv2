import { beforeEach, describe, expect, it } from "vitest";
import {
	ContentSources,
	WORLD_SOURCE_ID,
} from "../modules/system/content-sources.js";

// getSources resolves the per-category compendium setting into
// { packs, includeWorld }. The "world" sentinel in the setting array selects
// world items; an EMPTY setting means "everything" (all packs + world) —
// that default is load-bearing backward compatibility.

const pack = (collection, documentName = "Item", visible = true) => ({
	collection,
	documentName,
	visible,
	metadata: { label: collection },
});

const setSetting = (selected) => {
	game.settings.get.mockImplementation((_scope, key) =>
		key.startsWith("compendium.") ? selected : undefined,
	);
};

describe("ContentSources.getSources", () => {
	beforeEach(() => {
		game.packs = [
			pack("modA.themekits"),
			pack("world.my-kits"),
			pack("modB.effects", "ActiveEffect"),
		];
	});

	it("empty setting → all packs of the doc type, world included", () => {
		setSetting([]);
		const { packs, includeWorld } = ContentSources.getSources("themekits");
		expect(packs.map((p) => p.collection)).toEqual([
			"modA.themekits",
			"world.my-kits",
		]);
		expect(includeWorld).toBe(true);
	});

	it("packs-only selection → only those packs, world excluded", () => {
		setSetting(["modA.themekits"]);
		const { packs, includeWorld } = ContentSources.getSources("themekits");
		expect(packs.map((p) => p.collection)).toEqual(["modA.themekits"]);
		expect(includeWorld).toBe(false);
	});

	it("world-only selection → no packs, world included", () => {
		setSetting([WORLD_SOURCE_ID]);
		const { packs, includeWorld } = ContentSources.getSources("themekits");
		expect(packs).toEqual([]);
		expect(includeWorld).toBe(true);
	});

	it("mixed selection → selected packs plus world", () => {
		setSetting([WORLD_SOURCE_ID, "world.my-kits"]);
		const { packs, includeWorld } = ContentSources.getSources("themekits");
		expect(packs.map((p) => p.collection)).toEqual(["world.my-kits"]);
		expect(includeWorld).toBe(true);
	});

	it("unknown category → empty result, world excluded", () => {
		setSetting([]);
		expect(ContentSources.getSources("nonsense")).toEqual({
			packs: [],
			includeWorld: false,
		});
	});

	it("getPacks stays a thin wrapper over getSources().packs", () => {
		setSetting(["modA.themekits"]);
		expect(ContentSources.getPacks("themekits")).toEqual(
			ContentSources.getSources("themekits").packs,
		);
	});

	// Foundry serves pack contents to any client that asks — ownership only
	// gates writes. getSources' `visible` filter is the sole thing keeping
	// GM-only pack content out of player-facing pickers.
	it("packs invisible to the current user are excluded, even when selected", () => {
		game.packs = [pack("modA.themekits"), pack("gm.secrets", "Item", false)];
		setSetting(["modA.themekits", "gm.secrets"]);
		const { packs } = ContentSources.getSources("themekits");
		expect(packs.map((p) => p.collection)).toEqual(["modA.themekits"]);
	});

	it("invisible packs are excluded from the empty-setting 'everything' default", () => {
		game.packs = [pack("modA.themekits"), pack("gm.secrets", "Item", false)];
		setSetting([]);
		const { packs } = ContentSources.getSources("themekits");
		expect(packs.map((p) => p.collection)).toEqual(["modA.themekits"]);
	});

	it("statuses: still excludes the world story-tag pack from 'all packs'", () => {
		game.packs = [
			pack("world.litmv2-statuses", "ActiveEffect"),
			pack("world.litmv2-story-tags", "ActiveEffect"),
		];
		setSetting([]);
		const { packs } = ContentSources.getSources("statuses");
		expect(packs.map((p) => p.collection)).toEqual(["world.litmv2-statuses"]);
	});

	// A selected pack can vanish (its module was disabled). The config app counts
	// only sources that still exist, so with none left it reads "No sources
	// selected. All … are included" — getSources has to agree, or the hero
	// creation pickers sit empty under a banner promising everything.
	describe("selected sources that no longer exist", () => {
		it("every selected id gone → falls back to all packs and world", () => {
			setSetting(["gone.themekits"]);
			const { packs, includeWorld } = ContentSources.getSources("themekits");
			expect(packs.map((p) => p.collection)).toEqual([
				"modA.themekits",
				"world.my-kits",
			]);
			expect(includeWorld).toBe(true);
		});

		it("some ids gone → only the surviving selection, world excluded", () => {
			setSetting(["gone.themekits", "modA.themekits"]);
			const { packs, includeWorld } = ContentSources.getSources("themekits");
			expect(packs.map((p) => p.collection)).toEqual(["modA.themekits"]);
			expect(includeWorld).toBe(false);
		});

		it("a stale id next to the world sentinel keeps the world-only selection", () => {
			setSetting(["gone.themekits", WORLD_SOURCE_ID]);
			const { packs, includeWorld } = ContentSources.getSources("themekits");
			expect(packs).toEqual([]);
			expect(includeWorld).toBe(true);
		});

		it("a selected pack of another category does not count as existing", () => {
			setSetting(["modB.effects"]);
			const { packs, includeWorld } = ContentSources.getSources("themekits");
			expect(packs.map((p) => p.collection)).toEqual([
				"modA.themekits",
				"world.my-kits",
			]);
			expect(includeWorld).toBe(true);
		});

		// Existence, not visibility: falling back to "everything" for a player
		// whose only selected packs are GM-only would widen what they see.
		it("a selected pack that exists but is invisible stays empty, no fallback", () => {
			game.packs = [pack("modA.themekits"), pack("gm.secrets", "Item", false)];
			setSetting(["gm.secrets"]);
			const { packs, includeWorld } = ContentSources.getSources("themekits");
			expect(packs).toEqual([]);
			expect(includeWorld).toBe(false);
		});

		it("statuses: every selected id gone → all status packs, still without story tags", () => {
			game.packs = [
				pack("world.litmv2-statuses", "ActiveEffect"),
				pack("world.litmv2-story-tags", "ActiveEffect"),
			];
			setSetting(["gone.statuses"]);
			const { packs } = ContentSources.getSources("statuses");
			expect(packs.map((p) => p.collection)).toEqual(["world.litmv2-statuses"]);
		});

		// Statuses have no World row in the config app, so a stray sentinel
		// there is not a selection the app can show either.
		it("statuses: a stray world sentinel is not a live selection", () => {
			game.packs = [pack("world.litmv2-statuses", "ActiveEffect")];
			setSetting([WORLD_SOURCE_ID]);
			const { packs } = ContentSources.getSources("statuses");
			expect(packs.map((p) => p.collection)).toEqual(["world.litmv2-statuses"]);
		});
	});
});

// getCandidatePacks is the single definition of "which packs belong to a
// category" — shared by getSources (which layers `visible` on top) and the
// config app's checkbox list (which layers ownership display on top). The
// story-tags storage pack must never surface as a statuses candidate, or the
// config UI offers it even though getSources would ignore the selection.
describe("ContentSources.getCandidatePacks", () => {
	it("filters packs by the category's document type", () => {
		game.packs = [pack("modA.themekits"), pack("modB.effects", "ActiveEffect")];
		expect(
			ContentSources.getCandidatePacks("themekits").map((p) => p.collection),
		).toEqual(["modA.themekits"]);
	});

	it("statuses: excludes the world story-tag storage pack", () => {
		game.packs = [
			pack("world.litmv2-statuses", "ActiveEffect"),
			pack("world.litmv2-story-tags", "ActiveEffect"),
		];
		expect(
			ContentSources.getCandidatePacks("statuses").map((p) => p.collection),
		).toEqual(["world.litmv2-statuses"]);
	});

	it("includes packs invisible to the current user (config app mutes them instead)", () => {
		game.packs = [pack("modA.themekits"), pack("gm.secrets", "Item", false)];
		expect(
			ContentSources.getCandidatePacks("themekits").map((p) => p.collection),
		).toEqual(["modA.themekits", "gm.secrets"]);
	});

	it("unknown category → empty list", () => {
		game.packs = [pack("modA.themekits")];
		expect(ContentSources.getCandidatePacks("nonsense")).toEqual([]);
	});
});
