import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentSources } from "../modules/system/content-sources.js";

// getStatusEffectConfigs feeds CONFIG.statusEffects, whose v14 Proxy keys on the
// slugified id and throws on duplicate keys. Two docs that slugify to the same
// id (within or across packs) must collapse to one entry — last one wins — so
// the global never ends up with duplicate keys (#101). The result must also be a
// plain array, since callers spread it (`[...CONFIG.statusEffects]`).

const mockPack = (docs) => ({ getDocuments: async () => docs });
const doc = (id, name, img = `${id}.svg`) => ({ id, name, img });

describe("ContentSources.getStatusEffectConfigs", () => {
	it("maps each doc to an {id, _id, name, img} config keyed on the slugified name", async () => {
		const configs = await ContentSources.getStatusEffectConfigs([
			mockPack([doc("aaa", "Wounded", "blood.svg")]),
		]);
		expect(configs).toEqual([
			{ id: "wounded", _id: "aaa", name: "Wounded", img: "blood.svg" },
		]);
	});

	it("returns a real array so callers can spread it", async () => {
		const configs = await ContentSources.getStatusEffectConfigs([
			mockPack([doc("aaa", "Wounded")]),
		]);
		expect(Array.isArray(configs)).toBe(true);
	});

	it("dedupes docs that slugify to the same id within a pack — last wins", async () => {
		const configs = await ContentSources.getStatusEffectConfigs([
			mockPack([doc("aaa", "Wounded"), doc("bbb", "wounded")]),
		]);
		expect(configs).toHaveLength(1);
		expect(configs[0]).toMatchObject({ id: "wounded", _id: "bbb" });
	});

	it("dedupes a colliding id across packs — the later pack wins", async () => {
		const configs = await ContentSources.getStatusEffectConfigs([
			mockPack([doc("aaa", "Wounded")]),
			mockPack([doc("bbb", "Wounded")]),
		]);
		expect(configs).toHaveLength(1);
		expect(configs[0]._id).toBe("bbb");
	});

	it("collapses names that differ only by spacing/case to the same slug", async () => {
		const configs = await ContentSources.getStatusEffectConfigs([
			mockPack([doc("aaa", "Tired Out"), doc("bbb", "tired   out")]),
		]);
		expect(configs).toHaveLength(1);
		expect(configs[0].id).toBe("tired-out");
	});

	it("keeps distinct statuses separate", async () => {
		const configs = await ContentSources.getStatusEffectConfigs([
			mockPack([doc("aaa", "Wounded"), doc("bbb", "Poisoned")]),
		]);
		expect(configs.map((c) => c.id).sort()).toEqual(["poisoned", "wounded"]);
	});

	it("returns an empty array for no packs", async () => {
		expect(await ContentSources.getStatusEffectConfigs([])).toEqual([]);
	});

	// One unreadable pack (a corrupt or half-removed compendium) must not take
	// the other packs' statuses down with it, nor reject out of the ready hook.
	describe("a pack whose documents fail to load", () => {
		const failingPack = (collection = "broken.statuses") => ({
			collection,
			getDocuments: async () => {
				throw new Error("unreadable pack");
			},
		});

		beforeEach(() => {
			vi.spyOn(console, "error").mockImplementation(() => {});
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it("is skipped and logged; the other packs still load", async () => {
			const configs = await ContentSources.getStatusEffectConfigs([
				mockPack([doc("aaa", "Wounded")]),
				failingPack(),
				mockPack([doc("bbb", "Poisoned")]),
			]);
			expect(configs.map((c) => c.id)).toEqual(["wounded", "poisoned"]);
			expect(console.error).toHaveBeenCalledTimes(1);
		});

		it("every pack failing resolves to a plain empty array", async () => {
			const configs = await ContentSources.getStatusEffectConfigs([
				failingPack("a.statuses"),
				failingPack("b.statuses"),
			]);
			expect(configs).toEqual([]);
			expect(console.error).toHaveBeenCalledTimes(2);
		});
	});
});

// loadStatusCompendium is awaited in the ready hook ahead of
// Sockets.registerListeners() and the game.litmv2.storyTags alias, so a
// rejection there leaves that client with no sockets at all.
describe("ContentSources.loadStatusCompendium", () => {
	const statusPack = (collection, getDocuments) => ({
		collection,
		documentName: "ActiveEffect",
		visible: true,
		getDocuments,
	});

	beforeEach(() => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		vi.spyOn(console, "log").mockImplementation(() => {});
		game.settings.get.mockReset().mockReturnValue([]);
		CONFIG.statusEffects = [{ id: "dead" }];
	});

	afterEach(() => {
		vi.restoreAllMocks();
		game.settings.get.mockReset();
		game.packs = [];
		delete CONFIG.statusEffects;
	});

	it("loads the readable packs when another one rejects", async () => {
		game.packs = [
			statusPack("broken.statuses", async () => {
				throw new Error("unreadable pack");
			}),
			statusPack("world.litmv2-statuses", async () => [doc("aaa", "Wounded")]),
		];

		await expect(
			ContentSources.loadStatusCompendium(),
		).resolves.toBeUndefined();

		expect(CONFIG.statusEffects.map((c) => c.id)).toEqual(["wounded"]);
	});

	it("never rejects, whatever fails while resolving the packs", async () => {
		game.settings.get.mockImplementation(() => {
			throw new Error("setting not registered");
		});

		await expect(
			ContentSources.loadStatusCompendium(),
		).resolves.toBeUndefined();

		expect(CONFIG.statusEffects).toEqual([{ id: "dead" }]);
		expect(console.error).toHaveBeenCalled();
	});
});
