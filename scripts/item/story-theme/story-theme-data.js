import { levelIcon, localize as t } from "../../utils.js";

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
		// Strip legacy tag arrays — tags are now ActiveEffects.
		delete source.theme;
		return super.migrateData(source);
	}

	/* -------------------------------------------- */
	/*  Tag Getters (read from effects)             */
	/* -------------------------------------------- */

	get powerTags() {
		return this.parent.effects
			.filter((e) => (e.type === "power_tag" || e.type === "fellowship_tag") && !e.system.isTitleTag);
	}

	get weaknessTags() {
		return this.parent.effects
			.filter((e) => e.type === "weakness_tag");
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

	get themeTag() {
		return [...this.parent.effects].find((e) => e.system.isTitleTag) ?? null;
	}

	get allTags() {
		return [...this.parent.effects]
			.filter((e) => e.type === "power_tag" || e.type === "fellowship_tag" || e.type === "weakness_tag");
	}

	get availablePowerTags() {
		return this.powerTags.filter((e) => e.active);
	}
}
