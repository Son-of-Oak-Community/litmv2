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
		if (effects.some((e) =>
			e.type === "power_tag" || e.type === "weakness_tag" || e.type === "fellowship_tag"
		)) return;

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
	 * Create effects from stashed legacy data after item creation.
	 * Handles compendium imports and any other path where items are
	 * created without the world migration running.
	 */
	static async createLegacyEffects(item) {
		if (item.type === "theme" || item.type === "story_theme") {
			const legacy = item.getFlag("litmv2", "legacyTags");
			if (!legacy) return;

			const { powerTags = [], weaknessTags = [], isFellowship = false } = legacy;
			const powerType = isFellowship ? "fellowship_tag" : "power_tag";

			const effectData = [
				...powerTags.map((t) => ({
					name: t.name || "",
					type: powerType,
					disabled: !(t.isActive ?? false),
					system: { question: t.question ?? null, isScratched: t.isScratched ?? false },
				})),
				...weaknessTags.map((t) => ({
					name: t.name || "",
					type: "weakness_tag",
					disabled: !(t.isActive ?? false),
					system: { question: t.question ?? null },
				})),
			];

			if (item.name) {
				effectData.push({
					name: item.name,
					type: powerType,
					disabled: false,
					system: { question: "0", isScratched: item.system?.isScratched ?? false, isTitleTag: true },
				});
			}

			if (effectData.length) {
				await item.createEmbeddedDocuments("ActiveEffect", effectData);
			}
			await item.unsetFlag("litmv2", "legacyTags");
		}

		if (item.type === "backpack") {
			const contents = item.getFlag("litmv2", "legacyContents");
			if (!Array.isArray(contents) || !contents.length) return;

			const effectData = contents.map((t) => ({
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

			if (effectData.length) {
				await item.createEmbeddedDocuments("ActiveEffect", effectData);
			}
			await item.unsetFlag("litmv2", "legacyContents");
		}
	}
}
