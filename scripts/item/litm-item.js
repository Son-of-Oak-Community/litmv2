/**
 * Custom Item document class for Legend in the Mist.
 *
 * Document-level migrateData converts legacy tag arrays to ActiveEffect
 * entries on the source. This runs automatically on every document load
 * regardless of origin (world, compendium, unlinked token), ensuring
 * comprehensive coverage that the world-migration in migrations.js
 * cannot guarantee alone.
 */
export class LitmItem extends foundry.documents.Item {
	static migrateData(source) {
		if (source.type === "theme" || source.type === "story_theme") {
			LitmItem.#migrateThemeTags(source);
		}
		if (source.type === "backpack") {
			LitmItem.#migrateBackpackContents(source);
		}
		return super.migrateData(source);
	}

	/**
	 * Convert legacy powerTags/weaknessTags arrays to theme_tag effects.
	 */
	static #migrateThemeTags(source) {
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
		const existingThemeTags = effects.filter((e) => e.type === "theme_tag").length;
		const expectedCount = powerTags.length + weaknessTags.length;
		if (existingThemeTags >= expectedCount) return;

		for (const tag of powerTags) {
			effects.push({
				name: tag.name || "",
				type: "theme_tag",
				disabled: !(tag.isActive ?? false),
				system: {
					tagType: "powerTag",
					question: tag.question ?? null,
					isScratched: tag.isScratched ?? false,
					isSingleUse: tag.isSingleUse ?? false,
				},
			});
		}
		for (const tag of weaknessTags) {
			effects.push({
				name: tag.name || "",
				type: "theme_tag",
				disabled: !(tag.isActive ?? false),
				system: {
					tagType: "weaknessTag",
					question: tag.question ?? null,
					isScratched: tag.isScratched ?? false,
					isSingleUse: tag.isSingleUse ?? false,
				},
			});
		}
		source.effects = effects;
	}

	/**
	 * Convert legacy system.contents array to story_tag effects.
	 */
	static #migrateBackpackContents(source) {
		const contents = source.system?.contents;
		if (!Array.isArray(contents) || !contents.length) return;

		const effects = source.effects ?? [];
		const existingStoryTags = effects.filter((e) => e.type === "story_tag").length;
		if (existingStoryTags >= contents.length) return;

		for (const tag of contents) {
			effects.push({
				name: tag.name || "",
				type: "story_tag",
				transfer: true,
				disabled: !(tag.isActive ?? true),
				system: {
					isScratched: tag.isScratched ?? false,
					isSingleUse: tag.isSingleUse ?? false,
					isHidden: false,
				},
			});
		}
		source.effects = effects;
	}
}
