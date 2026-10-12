import { ITEM_DEFAULT_ICONS } from "../../system/config.js";

export class VignetteData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			limitedPermissionHidden: new fields.BooleanField({ initial: true }),
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

	get hasCustomImage() {
		return this.parent.img !== ITEM_DEFAULT_ICONS.vignette;
	}
}
