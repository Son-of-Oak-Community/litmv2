import { describe, expect, it } from "vitest";
import {
	catalogLevels,
	filterThemeCatalog,
	sortCatalog,
	toCatalogEntry,
} from "../modules/apps/theme-catalog.js";
import { getThemeLevels } from "../modules/system/config.js";

const pack = { collection: "litm.kits", metadata: { label: "Core Kits" } };

describe("toCatalogEntry", () => {
	it("builds a compendium uuid and reads a kit's level and themebook", () => {
		const entry = toCatalogEntry(
			{ _id: "abc", name: "Hardened Warrior", img: "w.webp", system: { level: "origin", themebook: "Skill or Trade" } },
			{ kind: "kit", pack },
		);
		expect(entry).toEqual({
			uuid: "Compendium.litm.kits.Item.abc",
			name: "Hardened Warrior",
			img: "w.webp",
			kind: "kit",
			level: "origin",
			isFellowship: false,
			themebook: "Skill or Trade",
			sourceLabel: "Core Kits",
		});
	});

	it("reads a book's theme_level and keeps a world item's own uuid", () => {
		const entry = toCatalogEntry(
			{ uuid: "Item.xyz", name: "Companion", system: { theme_level: "variable", isFellowship: false } },
			{ kind: "book", pack: null },
		);
		expect(entry).toMatchObject({ uuid: "Item.xyz", kind: "book", level: "variable", themebook: "", sourceLabel: "" });
	});

	it("drops an entry it cannot address", () => {
		expect(toCatalogEntry({ name: "No id" }, { kind: "kit", pack: null })).toBeNull();
	});
});

const kit = (name, extra = {}) => ({ uuid: name, name, kind: "kit", level: "origin", themebook: "", sourceLabel: "", isFellowship: false, ...extra });
const book = (name, extra = {}) => ({ ...kit(name), kind: "book", ...extra });

describe("filterThemeCatalog", () => {
	const all = [
		kit("Hardened Warrior", { themebook: "Skill or Trade" }),
		book("Skill or Trade"),
		book("Destiny", { level: "greatness" }),
		kit("Wandering Bard", { sourceLabel: "Homebrew" }),
	];
	const names = (list) => list.map((e) => e.name);

	it("matches text against name, a kit's themebook and the source", () => {
		expect(names(filterThemeCatalog(all, { text: "skill" }))).toEqual(["Hardened Warrior", "Skill or Trade"]);
		expect(names(filterThemeCatalog(all, { text: "HOMEBREW" }))).toEqual(["Wandering Bard"]);
	});

	it("filters by kind and level", () => {
		expect(names(filterThemeCatalog(all, { kind: "book" }))).toEqual(["Skill or Trade", "Destiny"]);
		expect(names(filterThemeCatalog(all, { level: "greatness" }))).toEqual(["Destiny"]);
	});

	it("returns everything with no filters", () => {
		expect(filterThemeCatalog(all)).toHaveLength(4);
	});
});

describe("sortCatalog and catalogLevels", () => {
	it("sorts by name, kits before a book of the same name", () => {
		const sorted = sortCatalog([book("Skill"), kit("Bard"), kit("Skill")]);
		expect(sorted.map((e) => `${e.kind}:${e.name}`)).toEqual(["kit:Bard", "kit:Skill", "book:Skill"]);
	});

	it("offers variable only when a book uses it", () => {
		expect(catalogLevels([kit("A")])).toEqual(getThemeLevels());
		expect(catalogLevels([book("B", { level: "variable" })])).toEqual([...getThemeLevels(), "variable"]);
	});
});
