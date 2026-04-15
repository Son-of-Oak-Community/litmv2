import { POWER_TAG_TYPES, THEME_TAG_TYPES, getThemeLevels, getDefaultThemeLevel } from "../../system/config.js";

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
				initial: () => getDefaultThemeLevel(),
				validate: (level) => getThemeLevels().includes(level),
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
		if ("level" in source && !getThemeLevels().includes(source.level)) {
			source.level = getDefaultThemeLevel();
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
			.filter((e) => POWER_TAG_TYPES.has(e.type) && !e.system.isTitleTag);
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
			.filter((e) => THEME_TAG_TYPES.has(e.type));
	}

	nextAvailableQuestion(tagType, themebook) {
		const questionKey = tagType === "power_tag" ? "powerTagQuestions" : "weaknessTagQuestions";
		const questions = themebook?.system?.[questionKey] ?? [];
		const usedQuestions = new Set(
			[...this.parent.effects]
				.filter((e) => e.type === tagType)
				.map((e) => e.system?.question)
				.filter((q) => q != null),
		);
		const startIdx = tagType === "power_tag" ? 1 : 0;
		for (let i = startIdx; i < questions.length; i++) {
			if (!`${questions[i] ?? ""}`.trim()) continue;
			const idx = String(i);
			if (!usedQuestions.has(idx)) return idx;
		}
		return null;
	}

}
