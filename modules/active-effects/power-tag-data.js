import { getLinkedRefName } from "../utils.js";
import { ScratchableMixin } from "./scratchable-mixin.js";

export class PowerTagData extends ScratchableMixin(
	foundry.data.ActiveEffectTypeDataModel,
) {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			question: new fields.StringField({
				initial: null,
				nullable: true,
				blank: true,
			}),
			isScratched: new fields.BooleanField({ initial: false }),
			isTitleTag: new fields.BooleanField({ initial: false }),
			linkedRefUuid: new fields.StringField({
				initial: null,
				nullable: true,
				blank: true,
			}),
		};
	}

	get canBurn() {
		return !this.isScratched;
	}

	get linkedRefName() {
		return getLinkedRefName(this.linkedRefUuid);
	}

	get allowedStates() {
		// GM-side cycle. "negative" is permitted for the rare Narrator override
		// (p.76) — placed last so the natural cycle hits "" → positive →
		// scratched first and only reaches the inversion on a fourth click.
		return ",positive,scratched,negative";
	}

	get playerAllowedStates() {
		// Players never flip a power tag negative — that's a Narrator-only
		// override. Their cycle is the natural "" → positive → scratched loop.
		return ",positive,scratched";
	}

	get defaultPolarity() {
		return 1;
	}

	toTagString(name) {
		return `[${name}]`;
	}
}
