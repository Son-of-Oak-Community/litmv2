import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeroCreationData } from "../modules/apps/welcome/hero-creation-data.js";

// The welcome overlay's trope/themekit/themebook indexes must respect the
// content-source setting for world items too — previously every matching
// world item was appended regardless of the setting.

const tropeEntry = {
	_id: "p1",
	name: "Pack Trope",
	img: "p.webp",
	type: "trope",
	system: { category: "Village Folk" },
};

const mkPack = () => ({
	collection: "modA.tropes",
	documentName: "Item",
	visible: true,
	metadata: { label: "Mod A Tropes" },
	index: { contents: [tropeEntry] },
	getIndex: vi.fn(async () => {}),
});

const worldTrope = {
	id: "w1",
	uuid: "Item.w1",
	name: "World Trope",
	img: "w.webp",
	type: "trope",
	system: { category: "Village Folk" },
	effects: [],
	testUserPermission: () => true,
};

const setSetting = (selected) => {
	game.settings.get.mockImplementation((_scope, key) =>
		key.startsWith("compendium.") ? selected : undefined,
	);
};

const loadTropeNames = async () => {
	const data = new HeroCreationData();
	await data.ensureIndexes();
	return data._cache.tropes.map((e) => e.name);
};

describe("HeroCreationData index loading respects world-item setting", () => {
	beforeEach(() => {
		game.packs = [mkPack()];
		game.items = [worldTrope];
	});

	it("empty setting → pack and world tropes", async () => {
		setSetting([]);
		expect((await loadTropeNames()).sort()).toEqual([
			"Pack Trope",
			"World Trope",
		]);
	});

	it("packs-only setting → world trope excluded", async () => {
		setSetting(["modA.tropes"]);
		expect(await loadTropeNames()).toEqual(["Pack Trope"]);
	});

	it("world-only setting → pack trope excluded", async () => {
		setSetting(["world"]);
		expect(await loadTropeNames()).toEqual(["World Trope"]);
	});

	it("world items the user cannot observe are excluded", async () => {
		setSetting(["world"]);
		game.items.push({
			...worldTrope,
			id: "w2",
			uuid: "Item.w2",
			name: "GM Draft",
			testUserPermission: () => false,
		});
		expect(await loadTropeNames()).toEqual(["World Trope"]);
	});
});
