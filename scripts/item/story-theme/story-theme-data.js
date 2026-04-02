import { effectToTag, levelIcon, localize as t, titleCase } from "../../utils.js";

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
				initial: () => Object.keys(CONFIG.litmv2.theme_levels)[0],
				validate: (level) =>
					Object.keys(CONFIG.litmv2.theme_levels).includes(level),
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
		const validLevels = Object.keys(CONFIG.litmv2?.theme_levels ?? {});
		if (validLevels.length && !validLevels.includes(source.level)) {
			source.level = validLevels[0];
		}
		// Strip legacy tag arrays — tags are now ActiveEffects
		delete source.theme;
		return super.migrateData(source);
	}

	/* -------------------------------------------- */
	/*  Tag Getters (read from effects)             */
	/* -------------------------------------------- */

	get powerTags() {
		return this.parent.effects
			.filter(
				(e) => e.type === "theme_tag" && e.system.tagType === "powerTag",
			)
			.map(effectToTag);
	}

	get weaknessTags() {
		return this.parent.effects
			.filter(
				(e) => e.type === "theme_tag" && e.system.tagType === "weaknessTag",
			)
			.map(effectToTag);
	}

	get themeTag() {
		const item = {
			id: this.parent._id,
			name: titleCase(this.parent.name),
			isActive: true,
			isScratched: this.isScratched ?? false,
			type: "themeTag",
		};
		return game.litmv2.data.TagData.fromSource(item);
	}

	get levelIcon() {
		return levelIcon(this.level);
	}

	get levels() {
		const levels = CONFIG.litmv2.theme_levels || {};
		return Object.keys(levels).reduce((acc, level) => {
			acc[level] = t(`LITM.Terms.${level}`);
			return acc;
		}, {});
	}

	get allTags() {
		return [...this.weaknessTags, ...this.powerTags, this.themeTag];
	}

	get availablePowerTags() {
		return [...this.powerTags, this.themeTag].filter(
			(tag) => tag.isActive && !tag.isScratched,
		);
	}
}
