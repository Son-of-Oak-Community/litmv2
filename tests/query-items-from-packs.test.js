import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryItemsFromPacks } from "../modules/utils.js";

// queryItemsFromPacks must respect the category's content-source setting for
// BOTH halves of its search: the compendium packs AND the world-item loop.
// Previously world items were always included regardless of the setting.

const mkPack = (collection, entries, visible = true) => ({
	collection,
	documentName: "Item",
	visible,
	metadata: { label: collection },
	index: { contents: entries },
	getIndex: vi.fn(async () => {}),
});

const mkWorldItem = (data, observable = true) => ({
	...data,
	testUserPermission: vi.fn(() => observable),
});

const setSetting = (selected) => {
	game.settings.get.mockImplementation((_scope, key) =>
		key.startsWith("compendium.") ? selected : undefined,
	);
};

describe("queryItemsFromPacks world-item gating", () => {
	beforeEach(() => {
		game.items = [mkWorldItem({ id: "w1", type: "theme", name: "World Kit" })];
		game.packs = [
			mkPack("modA.kits", [{ _id: "p1", type: "theme", name: "Pack Kit" }]),
		];
	});

	it("empty setting → world items and all packs", async () => {
		setSetting([]);
		const names = (
			await queryItemsFromPacks({ type: "theme", category: "themekits" })
		).map((e) => e.name);
		expect(names.sort()).toEqual(["Pack Kit", "World Kit"]);
	});

	it("packs-only setting → world items excluded", async () => {
		setSetting(["modA.kits"]);
		const names = (
			await queryItemsFromPacks({ type: "theme", category: "themekits" })
		).map((e) => e.name);
		expect(names).toEqual(["Pack Kit"]);
	});

	it("world-only setting → packs excluded", async () => {
		setSetting(["world"]);
		const names = (
			await queryItemsFromPacks({ type: "theme", category: "themekits" })
		).map((e) => e.name);
		expect(names).toEqual(["World Kit"]);
	});

	it("no category → legacy fallback: all Item packs plus world items", async () => {
		setSetting(["modA.kits"]); // must be ignored without a category
		const names = (await queryItemsFromPacks({ type: "theme" })).map(
			(e) => e.name,
		);
		expect(names.sort()).toEqual(["Pack Kit", "World Kit"]);
	});

	it("world items the user cannot observe are excluded", async () => {
		setSetting([]);
		game.items.push(
			mkWorldItem({ id: "w2", type: "theme", name: "GM Draft" }, false),
		);
		const names = (
			await queryItemsFromPacks({ type: "theme", category: "themekits" })
		).map((e) => e.name);
		expect(names.sort()).toEqual(["Pack Kit", "World Kit"]);
	});

	it("packs invisible to the user are excluded, with and without a category", async () => {
		setSetting([]);
		game.packs.push(
			mkPack(
				"gm.secrets",
				[{ _id: "s1", type: "theme", name: "Secret Kit" }],
				false,
			),
		);
		const withCategory = (
			await queryItemsFromPacks({ type: "theme", category: "themekits" })
		).map((e) => e.name);
		const withoutCategory = (await queryItemsFromPacks({ type: "theme" })).map(
			(e) => e.name,
		);
		expect(withCategory.sort()).toEqual(["Pack Kit", "World Kit"]);
		expect(withoutCategory.sort()).toEqual(["Pack Kit", "World Kit"]);
	});

	it("map still receives { pack: null } for world items and { pack } for pack entries", async () => {
		setSetting([]);
		const sources = await queryItemsFromPacks({
			type: "theme",
			category: "themekits",
			map: (_entry, { pack }) => (pack ? pack.collection : "world"),
		});
		expect(sources.sort()).toEqual(["modA.kits", "world"]);
	});
});
