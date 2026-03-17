import { localize as t, titleCase } from "../../utils.js";

export class ThemeData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		const abstract = game.litmv2.data;
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
			powerTags: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.TagData),
				{
					initial: () =>
						Array(2)
							.fill()
							.map((_, i) => ({
								id: foundry.utils.randomID(),
								name: "",
								question: "",
								isActive: i < 2,
								isScratched: false,
								type: "powerTag",
							})),
				},
			),
			weaknessTags: new fields.ArrayField(
				new fields.EmbeddedDataField(abstract.TagData),
				{
					initial: () =>
						Array(1)
							.fill()
							.map(() => ({
								id: foundry.utils.randomID(),
								name: "",
								question: "",
								isActive: true,
								isScratched: false,
								type: "weaknessTag",
							})),
				},
			),
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
			source.level === undefined ||
			!Object.keys(CONFIG.litmv2.theme_levels).includes(source.level)
		) {
			source.level = Object.keys(CONFIG.litmv2.theme_levels)[0];
		}
		for (const tag of source.powerTags ?? []) {
			if (!tag.id) tag.id = foundry.utils.randomID();
		}
		for (const tag of source.weaknessTags ?? []) {
			if (!tag.id) tag.id = foundry.utils.randomID();
		}
		return super.migrateData(source);
	}

	prepareDerivedData() {
		for (const tag of this.weaknessTags) {
			tag.isScratched = false;
		}
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
