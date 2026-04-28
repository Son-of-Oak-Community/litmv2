export { SUCCESS_VERBS } from "./verb-definitions.js";
import { SUCCESS_VERBS } from "./verb-definitions.js";

// Action successes are unlocked by the roll's result: Quick on a Success-with-
// Consequences, Detailed on a full Success. ExtraFeat is a bonus success
// purchased with extra Power.
export const SUCCESS_QUALITIES = Object.freeze([
	"quick", "detailed", "extraFeat",
]);

const TARGETS = Object.freeze([
	"self", "ally", "opponent", "process", "prompt",
]);

const POLARITIES = Object.freeze(["positive", "negative"]);

export const ACTION_CATEGORIES = Object.freeze([
	"", "battle", "cunning", "exploration", "magic", "rote", "social", "crafting", "custom",
]);

export class ActionData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;

		const tagSuggestion = () => new fields.SchemaField({
			label: new fields.StringField({ trim: true, initial: "" }),
			tagId: new fields.StringField({ initial: null, nullable: true, blank: true }),
		});

		return {
			description: new fields.HTMLField({ initial: "" }),
			practitioners: new fields.StringField({ trim: true, initial: "" }),
			category: new fields.StringField({
				initial: "",
				blank: true,
				choices: [...ACTION_CATEGORIES],
			}),
			customCategory: new fields.StringField({ trim: true, initial: "" }),
			actionExamples: new fields.ArrayField(
				new fields.StringField({ trim: true }),
				{ initial: () => [] },
			),
			power: new fields.SchemaField({
				positiveTags: new fields.ArrayField(tagSuggestion(), { initial: () => [] }),
				negativeTags: new fields.ArrayField(tagSuggestion(), { initial: () => [] }),
			}),
			successes: new fields.ArrayField(
				new fields.SchemaField({
					id: new fields.StringField({
						initial: () => foundry.utils.randomID(),
						required: true,
						blank: false,
					}),
					verb: new fields.StringField({
						initial: "enhance",
						choices: [...SUCCESS_VERBS],
					}),
					quality: new fields.StringField({
						initial: "quick",
						choices: [...SUCCESS_QUALITIES],
					}),
					label: new fields.StringField({ trim: true, initial: "" }),
					description: new fields.StringField({ trim: true, initial: "" }),
					payload: new fields.SchemaField({
						tagName: new fields.StringField({ trim: true, initial: "", blank: true }),
						statusName: new fields.StringField({ trim: true, initial: "", blank: true }),
						tier: new fields.NumberField({
							initial: null, nullable: true, integer: true, min: 1, max: 6,
						}),
						polarity: new fields.StringField({
							initial: "positive",
							choices: [...POLARITIES],
						}),
						isSingleUse: new fields.BooleanField({ initial: false }),
						scratchTag: new fields.BooleanField({ initial: false }),
						target: new fields.StringField({
							initial: "self",
							choices: [...TARGETS],
						}),
					}),
				}),
				{ initial: () => [] },
			),
			consequences: new fields.ArrayField(
				new fields.StringField({ trim: true }),
				{ initial: () => [] },
			),
			linkedRefUuid: new fields.StringField({ initial: null, nullable: true, blank: true }),
		};
	}

	/** Whether this action represents a magical rote (categorized as such). */
	get isRote() {
		return this.category === "rote";
	}

	/**
	 * Display label for the category. When `category === "custom"`, returns
	 * the user-authored `customCategory`; otherwise the localized choice
	 * label. Empty string when no category is set.
	 */
	get categoryLabel() {
		if (this.category === "custom") {
			return this.customCategory?.trim() || game.i18n.localize("LITM.Actions.categories.custom");
		}
		return this.category ? game.i18n.localize(`LITM.Actions.categories.${this.category}`) : "";
	}

	/** Successes filtered for a given roll quality, plus any extraFeat successes. */
	successesFor(quality) {
		return this.successes.filter((o) => o.quality === quality || o.quality === "extraFeat");
	}
}
