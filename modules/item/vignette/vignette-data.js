import { reconcileTagEffects } from "../../active-effects/effect-factories.js";
import { parseTagString } from "../action/tag-string.js";

export class VignetteData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			threat: new fields.StringField({
				initial: "",
			}),
			consequences: new fields.ArrayField(
				new fields.StringField({ required: false, nullable: false }),
				{
					initial: () => [],
				},
			),
			isConsequenceOnly: new fields.BooleanField({
				initial: false,
			}),
		};
	}

	/**
	 * Synchronize embedded effects to match consequence text.
	 * Parses tag/status markup from each consequence string, then
	 * creates, updates, or deletes ActiveEffects so the item's
	 * effects mirror the parsed result.
	 * @returns {Promise<void>}
	 */
	async syncEffectsFromConsequences() {
		// Parse consequence markup with the canonical tag-string parser so
		// `[name-N]` yields a status_tag (with a one-hot tiers array) and
		// `[name]` a story_tag — matching the rest of the system.
		const desired = this.consequences.flatMap(parseTagString);
		return reconcileTagEffects(this.parent, desired);
	}
}
