import { ScratchableMixin } from "./scratchable-mixin.js";

export class RelationshipTagData extends ScratchableMixin(foundry.data.ActiveEffectTypeDataModel) {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			targetId: new fields.StringField({ initial: "", nullable: false }),
			isScratched: new fields.BooleanField({ initial: false }),
		};
	}

	get isSingleUse() {
		return true;
	}

	get canBurn() {
		return false;
	}

	get allowedStates() {
		return ",positive,negative";
	}

	get defaultPolarity() {
		return 1;
	}
}
