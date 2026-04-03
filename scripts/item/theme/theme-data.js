import { levelIcon, localize as t } from "../../utils.js";

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
			isScratched: new fields.BooleanField({ initial: false }),
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
		// Strip legacy array fields — tags are now ActiveEffects.
		// (These would be pruned by schema validation anyway, but explicit is clearer.)
		delete source.powerTags;
		delete source.weaknessTags;
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

	get themeTag() {
		return [...this.parent.effects].find((e) => e.system.isTitleTag) ?? null;
	}

	get activatedPowerTags() {
		return this.powerTags.filter((e) => e.active);
	}

	get availablePowerTags() {
		return this.activatedPowerTags;
	}

	get allTags() {
		return [...this.parent.effects]
			.filter((e) => e.type === "power_tag" || e.type === "fellowship_tag" || e.type === "weakness_tag");
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

	get themebooks() {
		return CONFIG.litmv2.theme_levels?.[this.level] || [];
	}
}
