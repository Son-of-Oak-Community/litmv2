import { syncTagStringEffects } from "../../item/action/tag-string.js";
import { advanceFlagLimit } from "../mixins/actor-limits.js";
import { EffectTagsMixin } from "../mixins/effect-tags-mixin.js";
import { LimitsMixin } from "../mixins/limits-mixin.js";

export class JourneyData extends LimitsMixin(
	EffectTagsMixin(foundry.abstract.TypeDataModel),
) {
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

	/**
	 * Converge this journey's story/status effects onto bracket tag markup.
	 * Used by the edit→play mode sync; also callable from macros.
	 * @param {string} tagsString
	 * @returns {Promise<void>}
	 */
	async syncEffectsFromTagString(tagsString) {
		return syncTagStringEffects(this.parent, tagsString);
	}

	/**
	 * Journey vignettes may carry ActiveEffects for consequence markup.
	 * Exclude those vignette-owned effects from the actor's story/status
	 * collections so they do not appear in the story-tag sidebar.
	 */
	get storyTags() {
		return super.storyTags.filter((e) => e.parent?.type !== "vignette");
	}

	get statusEffects() {
		return super.statusEffects.filter((e) => e.parent?.type !== "vignette");
	}
}
