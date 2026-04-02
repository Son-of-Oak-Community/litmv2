import { localize as t, titleCase } from "../../utils.js";

/**
 * Map a theme_tag ActiveEffect to a TagData-compatible plain object.
 * @param {ActiveEffect} effect
 * @returns {object}
 */
function effectToTag(effect) {
	return {
		id: effect.id,
		name: effect.name,
		question: effect.system.question ?? null,
		isActive: !effect.disabled,
		isScratched: effect.system.isScratched,
		isSingleUse: effect.system.isSingleUse,
		type: effect.system.tagType,
	};
}

export class ThemeData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			description: new fields.HTMLField({
				initial: "",
			}),
			themebook: new fields.StringField({
				trim: true,
				initial: "",
			}),
			level: new fields.StringField({
				trim: true,
				initial: () => Object.keys(CONFIG.litmv2.theme_levels)[0],
				validate: (level) =>
					Object.keys(CONFIG.litmv2.theme_levels).includes(level),
			}),
			isScratched: new fields.BooleanField(),
			isFellowship: new fields.BooleanField({
				initial: false,
			}),
			improve: new fields.SchemaField({
				value: new fields.NumberField({
					initial: 0,
					min: 0,
					max: 3,
					integer: true,
				}),
			}),
			quest: new fields.SchemaField({
				description: new fields.StringField({
					initial: "",
				}),
				tracks: new fields.SchemaField({
					abandon: new fields.SchemaField({
						value: new fields.NumberField({
							initial: 0,
							min: 0,
							max: 3,
							integer: true,
						}),
					}),
					milestone: new fields.SchemaField({
						value: new fields.NumberField({
							initial: 0,
							min: 0,
							max: 3,
							integer: true,
						}),
					}),
				}),
			}),
			specialImprovements: new fields.ArrayField(
				new fields.SchemaField({
					name: new fields.StringField({
						trim: true,
						initial: "",
					}),
					description: new fields.StringField({
						trim: true,
						initial: "",
					}),
					isActive: new fields.BooleanField({
						initial: false,
					}),
				}),
				{
					initial: () => [],
				},
			),
		};
	}

	static migrateData(source) {
		if (
			"level" in source &&
			!Object.keys(CONFIG.litmv2.theme_levels).includes(source.level)
		) {
			source.level = Object.keys(CONFIG.litmv2.theme_levels)[0];
		}
		// Strip legacy array fields — tags are now ActiveEffects
		delete source.powerTags;
		delete source.weaknessTags;
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
		const isScratched = this.isScratched ?? false;
		const item = {
			id: this.parent._id,
			name: titleCase(this.parent.name),
			isActive: true,
			isScratched,
			type: "themeTag",
		};
		return game.litmv2.data.TagData.fromSource(item);
	}

	get activatedPowerTags() {
		const powerTags = this.powerTags;
		const themeTag = this.themeTag;
		return [...powerTags, themeTag].filter((tag) => tag.isActive);
	}

	get availablePowerTags() {
		return this.activatedPowerTags.filter((tag) => !tag.isScratched);
	}

	get powerTagRatio() {
		return this.availablePowerTags.length / this.activatedPowerTags.length;
	}

	get weakness() {
		return this.weaknessTags;
	}

	get allTags() {
		return [...this.weaknessTags, ...this.powerTags, this.themeTag];
	}

	get levelIcon() {
		return `systems/litmv2/assets/media/icons/${this.level}.svg`;
	}

	get levels() {
		const levels = CONFIG.litmv2.theme_levels || {};
		return Object.keys(levels).reduce((acc, level) => {
			acc[level] = t(`LITM.Terms.${level}`);
			return acc;
		}, {});
	}

	get themebooks() {
		return CONFIG.litmv2.theme_levels?.[this.level] || [];
	}
}
