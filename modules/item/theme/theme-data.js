import {
	getDefaultThemeLevel,
	getThemeLevels,
	LitmConfig,
	POWER_TAG_TYPES,
} from "../../system/config.js";

/** Power tags, title tag included, that end a theme's nascent stage (p.192). */
export const NASCENT_POWER_TAGS = 3;

export class ThemeData extends foundry.abstract.TypeDataModel {
	static requiresTitleTag = true;

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
					// Resolved when the schema is first built (post-init, so the
					// improve_threshold setting is already mirrored). The setting
					// is requiresReload, which rebuilds the schema on change.
					max: LitmConfig.improveThreshold,
					min: 0,
					integer: true,
				}),
			}),
			// Marks a nascent theme (Core Book p.192): non-zero from a Replace
			// until the theme has NASCENT_POWER_TAGS power tags, title tag
			// included. See {@link ThemeData#isNascent}.
			nascentImprovements: new fields.NumberField({
				initial: 0,
				min: 0,
				max: 2,
				integer: true,
			}),
			// Improve points a nascent theme turned into "add a power tag" that
			// the player has not added yet.
			nascentPending: new fields.NumberField({
				initial: 0,
				min: 0,
				max: 2,
				integer: true,
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
		return this.parent.effects.filter(
			(e) => POWER_TAG_TYPES.has(e.type) && !e.system.isTitleTag,
		);
	}

	get weaknessTags() {
		return this.parent.effects.filter((e) => e.type === "weakness_tag");
	}

	get themeTag() {
		return [...this.parent.effects].find((e) => e.system.isTitleTag) ?? null;
	}

	/** The theme's gained power tags, title tag included. */
	get powerTagCount() {
		return this.parent.effects.filter(
			(e) => POWER_TAG_TYPES.has(e.type) && !e.disabled,
		).length;
	}

	/**
	 * A replaced theme starts with its title tag only (Core Book p.192). Until
	 * it has three power tags, each Improve it would mark is a new power tag
	 * instead; then it is a normal theme again.
	 */
	get isNascent() {
		return (
			this.nascentImprovements > 0 && this.powerTagCount < NASCENT_POWER_TAGS
		);
	}

	/** Power tags this theme is owed and the player has not added yet. */
	get owedPowerTags() {
		return this.isNascent ? this.nascentPending : 0;
	}

	/** Whether the theme can take an improvement now: an owed tag, or a full Improve track. */
	get canAdvance() {
		return (
			this.owedPowerTags > 0 ||
			(this.improve?.value ?? 0) >= CONFIG.litmv2.improveThreshold
		);
	}

	/** Power tags a nascent theme still needs, beyond those already owed. */
	get nascentTagsToOwe() {
		if (!this.isNascent) return 0;
		return Math.max(
			0,
			NASCENT_POWER_TAGS - this.powerTagCount - this.nascentPending,
		);
	}

	nextAvailableQuestion(tagType, themebook) {
		const questionKey =
			tagType === "power_tag" ? "powerTagQuestions" : "weaknessTagQuestions";
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
