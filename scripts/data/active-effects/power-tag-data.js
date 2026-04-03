import { ScratchableMixin } from "./scratchable-mixin.js";

export class PowerTagData extends ScratchableMixin(foundry.data.ActiveEffectTypeDataModel) {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			question: new fields.StringField({ initial: null, nullable: true, blank: true }),
			isScratched: new fields.BooleanField({ initial: false }),
			isTitleTag: new fields.BooleanField({ initial: false }),
		};
	}

	get canBurn() {
		return !this.isScratched;
	}

	get allowedStates() {
		return ",positive,scratched";
	}

	get defaultPolarity() {
		return 1;
	}
}
