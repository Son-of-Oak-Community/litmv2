import { EffectTagsMixin } from "../effect-tags-mixin.js";
import { advanceFlagLimit } from "../actor-limits.js";

export class JourneyData extends EffectTagsMixin(foundry.abstract.TypeDataModel) {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			category: new fields.StringField({
				initial: "",
			}),
			description: new fields.HTMLField({ initial: "" }),
			tags: new fields.StringField({
				initial: "",
			}),
			generalConsequences: new fields.StringField({ initial: "" }),
		};
	}

	/**
	 * Advance (or set back) a flag-stored limit by `delta`.
	 * @param {string} limitId
	 * @param {number} delta
	 * @returns {Promise<import("../actor-limits.js").LimitChangeResult|null>}
	 */
	async advanceLimit(limitId, delta) {
		return advanceFlagLimit(this.parent, limitId, delta);
	}
}
