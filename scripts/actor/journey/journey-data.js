import { EffectTagsMixin } from "../effect-tags-mixin.js";

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
}
