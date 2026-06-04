import { describe, expect, it } from "vitest";
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
});
