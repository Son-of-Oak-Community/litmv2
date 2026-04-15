import { THEME_TAG_TYPES } from "../system/config.js";

/**
 * Build ActiveEffect creation data from legacy theme tag arrays.
 * Shared by document-level createLegacyEffects and the world migration.
 * @param {object} legacy - { powerTags, weaknessTags, isFellowship }
 * @param {object} [titleTag] - { name, isScratched } for the title tag, or falsy to skip
 * @returns {object[]}
 */
export function buildThemeTagEffects(legacy, titleTag) {
	const { powerTags = [], weaknessTags = [], isFellowship = false } = legacy;
	const powerType = isFellowship ? "fellowship_tag" : "power_tag";
	const effects = [
		...powerTags.map((t) => ({
			name: t.name || "",
			type: powerType,
			disabled: !(t.isActive ?? false),
			system: {
				question: t.question ?? null,
				isScratched: t.isScratched ?? false,
			},
		})),
		...weaknessTags.map((t) => ({
			name: t.name || "",
			type: "weakness_tag",
			disabled: !(t.isActive ?? false),
			system: { question: t.question ?? null },
		})),
	];
	if (titleTag?.name) {
		effects.push({
			name: titleTag.name,
			type: powerType,
			disabled: false,
			system: {
				question: "0",
				isScratched: titleTag.isScratched ?? false,
				isTitleTag: true,
			},
		});
	}
	return effects;
}

/**
 * Build ActiveEffect creation data from legacy backpack contents.
 * @param {object[]} contents - Array of legacy tag objects
 * @returns {object[]}
 */
export function buildBackpackTagEffects(contents) {
	return contents.map((t) => ({
		name: t.name || "",
		type: "story_tag",
		transfer: true,
		disabled: !(t.isActive ?? true),
		system: {
			isScratched: t.isScratched ?? false,
			isSingleUse: t.isSingleUse ?? false,
			isHidden: false,
		},
	}));
}

/**
 * Custom Item document class for Legend in the Mist.
 *
 * migrateData stashes legacy tag arrays in flags before schema validation
 * prunes them. The world migration and the createItem hook read the flags
 * and create proper ActiveEffect documents.
 */
export class LitmItem extends foundry.documents.Item {
	static migrateData(source) {
		if (source.type === "theme" || source.type === "story_theme") {
			LitmItem.#stashLegacyThemeTags(source);
		}
		if (source.type === "backpack") {
			LitmItem.#stashLegacyBackpackContents(source);
		}
		// Reshape existing effects (flag→system for isTitleTag)
		for (const e of (source.effects ?? [])) {
			if (e.flags?.litmv2?.isTitleTag && !e.system?.isTitleTag) {
				e.system ??= {};
				e.system.isTitleTag = true;
				delete e.flags.litmv2.isTitleTag;
			}
		}
		return super.migrateData(source);
	}

	static #stashLegacyThemeTags(source) {
		const sys = source.system ?? {};
		const isStoryTheme = source.type === "story_theme";
		const powerTags = isStoryTheme
			? (sys.theme?.powerTags ?? sys.powerTags ?? [])
			: (sys.powerTags ?? []);
		const weaknessTags = isStoryTheme
			? (sys.theme?.weaknessTags ?? sys.weaknessTags ?? [])
			: (sys.weaknessTags ?? []);

		if (!powerTags.length && !weaknessTags.length) return;

		const effects = source.effects ?? [];
		if (effects.some((e) => THEME_TAG_TYPES.has(e.type))) return;

		source.flags ??= {};
		source.flags.litmv2 ??= {};
		source.flags.litmv2.legacyTags = {
			powerTags,
			weaknessTags,
			isFellowship: sys.isFellowship ?? false,
		};
	}

	static #stashLegacyBackpackContents(source) {
		const contents = source.system?.contents;
		if (!Array.isArray(contents) || !contents.length) return;

		const effects = source.effects ?? [];
		if (effects.some((e) => e.type === "story_tag")) return;

		source.flags ??= {};
		source.flags.litmv2 ??= {};
		source.flags.litmv2.legacyContents = contents;
	}

	/**
	 * Ensure a theme or story_theme item has exactly one title tag effect.
	 * Creates one from the item name if missing, removes duplicates if present.
	 */
	static async ensureTitleTag(item) {
		if (item.type !== "theme" && item.type !== "story_theme") return;
		const titleTags = [...item.effects].filter((e) => e.system?.isTitleTag);
		if (titleTags.length > 1) {
			const toDelete = titleTags.slice(1).map((e) => e.id);
			await item.deleteEmbeddedDocuments("ActiveEffect", toDelete);
			return;
		}
		if (titleTags.length === 1) return;
		const type = item.system.isFellowship ? "fellowship_tag" : "power_tag";
		await item.createEmbeddedDocuments("ActiveEffect", [{
			name: item.name || "",
			type,
			disabled: false,
			system: { question: "0", isScratched: false, isTitleTag: true },
		}]);
	}

	/**
	 * Create effects from stashed legacy data after item creation.
	 * Handles compendium imports and any other path where items are
	 * created without the world migration running.
	 */
	static async createLegacyEffects(item) {
		if (item.type === "theme" || item.type === "story_theme") {
			await LitmItem.#createLegacyThemeEffects(item);
		}
		if (item.type === "backpack") {
			await LitmItem.#createLegacyBackpackEffects(item);
		}
	}

	static async #createLegacyThemeEffects(item) {
		const legacy = item.getFlag("litmv2", "legacyTags");
		if (!legacy || item.effects.size) return;

		const effectData = buildThemeTagEffects(legacy, {
			name: item.name,
			isScratched: item.system?.isScratched ?? false,
		});

		if (effectData.length) {
			await item.createEmbeddedDocuments("ActiveEffect", effectData);
		}
		const { ForcedDeletion } = foundry.data.operators;
		await item.update({
			system: { powerTags: new ForcedDeletion(), weaknessTags: new ForcedDeletion() },
			flags: { litmv2: { legacyTags: new ForcedDeletion() } },
		});
	}

	static async #createLegacyBackpackEffects(item) {
		const contents = item.getFlag("litmv2", "legacyContents");
		if (!Array.isArray(contents) || !contents.length) return;
		if (item.effects.some((e) => e.type === "story_tag")) return;

		const effectData = buildBackpackTagEffects(contents);

		if (effectData.length) {
			await item.createEmbeddedDocuments("ActiveEffect", effectData);
		}
		const { ForcedDeletion } = foundry.data.operators;
		await item.update({
			system: { contents: new ForcedDeletion() },
			flags: { litmv2: { legacyContents: new ForcedDeletion() } },
		});
	}
}
