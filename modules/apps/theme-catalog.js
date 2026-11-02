import { getThemeLevels } from "../system/config.js";
import { queryItemsFromPacks } from "../utils.js";

/**
 * The themes a Hero or the Fellowship can take on, from the configured
 * content sources: theme kits (ready-made `theme` items in a `themekits`
 * source) and themebooks (the `themebooks` source). One entry shape for
 * both, so every picker lists, filters and drags them the same way.
 *
 * @typedef {object} ThemeCatalogEntry
 * @property {string} uuid
 * @property {string} name
 * @property {string} img
 * @property {"kit"|"book"} kind
 * @property {string} level         Might tier key, or "variable" for a book
 * @property {boolean} isFellowship
 * @property {string} themebook     For a kit, the themebook it was made from
 * @property {string} sourceLabel   Pack label, or "" for a world item
 */

const KIND_SOURCES = {
	kit: { type: "theme", category: "themekits", levelField: "system.level" },
	book: {
		type: "themebook",
		category: "themebooks",
		levelField: "system.theme_level",
	},
};

/**
 * Load every kit and book the current user may see.
 * @param {{isFellowship?: boolean}} [options]  Keep only Fellowship (true) or
 *   Hero (false) themes; omit for both
 * @returns {Promise<ThemeCatalogEntry[]>} Sorted by name
 */
export async function loadThemeCatalog({ isFellowship } = {}) {
	const entries = [];
	for (const [kind, source] of Object.entries(KIND_SOURCES)) {
		const found = await queryItemsFromPacks({
			type: source.type,
			category: source.category,
			indexFields: [
				"img",
				source.levelField,
				"system.isFellowship",
				"system.themebook",
			],
			map: (entry, { pack }) => toCatalogEntry(entry, { kind, pack }),
		});
		entries.push(...found.filter(Boolean));
	}
	return sortCatalog(
		isFellowship === undefined
			? entries
			: entries.filter((e) => e.isFellowship === isFellowship),
	);
}

/**
 * One index entry or world item as a catalog entry.
 * @param {object} entry
 * @param {{kind: "kit"|"book", pack: CompendiumCollection|null}} options
 * @returns {ThemeCatalogEntry|null}
 */
export function toCatalogEntry(entry, { kind, pack }) {
	const id = entry._id ?? entry.id;
	const uuid =
		entry.uuid || (pack && id ? `Compendium.${pack.collection}.Item.${id}` : "");
	if (!uuid) return null;
	const system = entry.system ?? {};
	return {
		uuid,
		name: entry.name ?? "",
		img: entry.img ?? "",
		kind,
		level: (kind === "book" ? system.theme_level : system.level) ?? "",
		isFellowship: !!system.isFellowship,
		themebook: kind === "kit" ? (system.themebook ?? "") : "",
		sourceLabel: pack ? (pack.metadata?.label ?? pack.collection) : "",
	};
}

/**
 * Sort by name; a kit and a book of the same name keep kits first.
 * @param {ThemeCatalogEntry[]} entries
 * @returns {ThemeCatalogEntry[]}
 */
export function sortCatalog(entries) {
	return [...entries].sort(
		(a, b) =>
			a.name.localeCompare(b.name) || (a.kind === b.kind ? 0 : a.kind === "kit" ? -1 : 1),
	);
}

/**
 * Narrow the catalog. Text matches the name, the themebook a kit came from,
 * and the source label, case-insensitively.
 * @param {ThemeCatalogEntry[]} entries
 * @param {{text?: string, kind?: ""|"kit"|"book", level?: string}} [filters]
 * @returns {ThemeCatalogEntry[]}
 */
export function filterThemeCatalog(entries, { text = "", kind = "", level = "" } = {}) {
	const needle = text.trim().toLowerCase();
	return entries.filter((e) => {
		if (kind && e.kind !== kind) return false;
		if (level && e.level !== level) return false;
		if (!needle) return true;
		return [e.name, e.themebook, e.sourceLabel]
			.filter(Boolean)
			.some((s) => s.toLowerCase().includes(needle));
	});
}

/**
 * The level filter's options: the configured tiers, then "variable" when a
 * book in the catalog uses it.
 * @param {ThemeCatalogEntry[]} entries
 * @returns {string[]}
 */
export function catalogLevels(entries) {
	const levels = [...getThemeLevels()];
	if (entries.some((e) => e.level === "variable")) levels.push("variable");
	return levels;
}
