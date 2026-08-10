export { SUCCESS_VERBS } from "./verb-definitions.js";

import { maxStatusTier } from "../../active-effects/status-tag-data.js";
import { SUCCESS_VERBS } from "./verb-definitions.js";

export const ACTION_CATEGORIES = Object.freeze([
	"",
	"battle",
	"cunning",
	"exploration",
	"magic",
	"rote",
	"social",
	"crafting",
	"custom",
]);

export class ActionData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;

		const tagSuggestion = () =>
			new fields.SchemaField({
				label: new fields.StringField({ trim: true, initial: "" }),
				tagId: new fields.StringField({
					initial: null,
					nullable: true,
					blank: true,
				}),
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
				positiveTags: new fields.ArrayField(tagSuggestion(), {
					initial: () => [],
				}),
				negativeTags: new fields.ArrayField(tagSuggestion(), {
					initial: () => [],
				}),
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
					text: new fields.StringField({ trim: true, initial: "" }),
				}),
				{ initial: () => [] },
			),
			extraFeats: new fields.ArrayField(
				new fields.StringField({ trim: true }),
				{ initial: () => [] },
			),
			consequences: new fields.ArrayField(
				new fields.StringField({ trim: true }),
				{ initial: () => [] },
			),
			linkedRefUuid: new fields.StringField({
				initial: null,
				nullable: true,
				blank: true,
			}),
		};
	}

	/**
	 * Convert legacy success entries (quality + structured payload) into the
	 * markup-driven shape (verb + free-text). Extra-feat successes get hoisted
	 * to the top-level `extraFeats` array; quick-quality successes have their
	 * verb forced to `quick` regardless of the original verb because quick
	 * successes are narrative-only by definition.
	 */
	static migrateData(source) {
		if (Array.isArray(source?.successes)) {
			const carriedFeats = Array.isArray(source.extraFeats)
				? [...source.extraFeats]
				: [];
			const newSuccesses = [];

			for (const s of source.successes) {
				// Already-migrated entries (no quality/payload/label/description) are
				// passed through untouched so re-runs are idempotent.
				if (
					s.text !== undefined &&
					s.quality === undefined &&
					s.payload === undefined &&
					s.label === undefined &&
					s.description === undefined
				) {
					newSuccesses.push(s);
					continue;
				}

				const isExtraFeat = s.quality === "extraFeat" || s.verb === "extraFeat";

				const text = _buildMigratedText(s);

				if (isExtraFeat) {
					if (text) carriedFeats.push(text);
					continue;
				}

				const verb = s.quality === "quick" ? "quick" : s.verb || "enhance";

				newSuccesses.push({
					id: s.id || foundry.utils.randomID(),
					verb,
					text,
				});
			}

			source.successes = newSuccesses;
			source.extraFeats = carriedFeats;
		}

		return super.migrateData(source);
	}

	/** Whether this action represents a magical rote (categorized as such). */
	get isRote() {
		return this.category === "rote";
	}
}

/**
 * Stitch a legacy success's label + description + synthesized payload markup
 * into a single text string. Order: prose first, markup tokens trailing —
 * keeps the author's narrative intent intact while still making the mechanical
 * effect parseable by the same regex that handles consequences.
 */
function _buildMigratedText(s) {
	const label = (s.label || "").trim();
	const description = (s.description || "").trim();
	const markup = _payloadToMarkup(s.payload);

	const prose = [label, description].filter(Boolean).join(" — ");
	if (prose && markup) return `${prose} ${markup}`;
	return prose || markup;
}

function _payloadToMarkup(payload) {
	if (!payload || typeof payload !== "object") return "";
	const tokens = [];
	const tagName = (payload.tagName || "").trim();
	const statusName = (payload.statusName || "").trim();
	const tier = Number(payload.tier);

	if (tagName) {
		tokens.push(payload.isSingleUse ? `[${tagName}!]` : `[${tagName}]`);
	}
	if (statusName) {
		if (Number.isInteger(tier) && tier >= 1 && tier <= maxStatusTier()) {
			tokens.push(`[${statusName}-${tier}]`);
		} else {
			tokens.push(`[${statusName}-]`);
		}
	}
	return tokens.join(" ");
}
