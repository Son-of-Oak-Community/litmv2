import { ScratchableMixin } from "./scratchable-mixin.js";

export class StoryTagData extends ScratchableMixin(foundry.data.ActiveEffectTypeDataModel) {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			isScratched: new fields.BooleanField({ initial: false }),
			isSingleUse: new fields.BooleanField({ initial: false }),
			isHidden: new fields.BooleanField({ initial: false }),
			limitId: new fields.StringField({ initial: null, nullable: true }),
		};
	}

	get canBurn() {
		return !this.isSingleUse && !this.isScratched;
	}

	get allowedStates() {
		return this.isSingleUse ? ",positive,negative" : ",positive,negative,scratched";
	}

	get defaultPolarity() {
		return null;
	}
}
