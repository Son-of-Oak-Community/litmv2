import { ScratchableMixin } from "./scratchable-mixin.js";

export class FellowshipTagData extends ScratchableMixin(foundry.data.ActiveEffectTypeDataModel) {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			question: new fields.StringField({ initial: null, nullable: true, blank: true }),
			isScratched: new fields.BooleanField({ initial: false }),
			isTitleTag: new fields.BooleanField({ initial: false }),
		};
	}

	get isSingleUse() {
		return true;
	}

	get canBurn() {
		return false;
	}

	get allowedStates() {
		return ",positive";
	}

	get defaultPolarity() {
		return 1;
	}
}
