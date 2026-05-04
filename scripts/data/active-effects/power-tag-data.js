import { ScratchableMixin } from "./scratchable-mixin.js";
import { getLinkedRefName } from "../../utils.js";

export class PowerTagData extends ScratchableMixin(foundry.data.ActiveEffectTypeDataModel) {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			question: new fields.StringField({ initial: null, nullable: true, blank: true }),
			isScratched: new fields.BooleanField({ initial: false }),
			isTitleTag: new fields.BooleanField({ initial: false }),
			linkedRefUuid: new fields.StringField({ initial: null, nullable: true, blank: true }),
		};
	}

	get canBurn() {
		return !this.isScratched;
	}

	get linkedRefName() {
		return getLinkedRefName(this.linkedRefUuid);
	}

	get allowedStates() {
		return ",positive,scratched";
	}

	get defaultPolarity() {
		return 1;
	}

	toTagString(name) {
		return `[${name}]`;
	}
}
