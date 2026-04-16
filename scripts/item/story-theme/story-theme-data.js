import { THEME_TAG_TYPES, POWER_TAG_TYPES, getThemeLevels, getDefaultThemeLevel } from "../../system/config.js";

export class StoryThemeData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			isScratched: new fields.BooleanField({ initial: false }),
			description: new fields.HTMLField({
				initial: "",
			}),
			level: new fields.StringField({
				trim: true,
				initial: () => getDefaultThemeLevel(),
				validate: (level) => getThemeLevels().includes(level),
			}),
		};
	}

	static migrateData(source) {
		// Move level from theme.level to top-level level
		if (source.theme?.level) {
			source.level ??= source.theme.level;
			delete source.theme.level;
		}
		// Migrate invalid "story" level to first valid level
		const validLevels = getThemeLevels();
		if (validLevels.length && !validLevels.includes(source.level)) {
			source.level = getDefaultThemeLevel();
		}
		// Strip legacy tag arrays — tags are now ActiveEffects.
		delete source.theme;
		return super.migrateData(source);
	}

	/* -------------------------------------------- */
	/*  Tag Getters (read from effects)             */
	/* -------------------------------------------- */

	get powerTags() {
		return this.parent.effects
			.filter((e) => POWER_TAG_TYPES.has(e.type) && !e.system.isTitleTag);
	}

	get weaknessTags() {
		return this.parent.effects
			.filter((e) => e.type === "weakness_tag");
	}

	get themeTag() {
		return [...this.parent.effects].find((e) => e.system.isTitleTag) ?? null;
	}

	get allTags() {
		return [...this.parent.effects]
			.filter((e) => THEME_TAG_TYPES.has(e.type));
	}

	get availablePowerTags() {
		return this.powerTags.filter((e) => e.active);
	}
}
