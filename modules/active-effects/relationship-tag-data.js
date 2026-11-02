import { ScratchableMixin } from "./scratchable-mixin.js";

export class RelationshipTagData extends ScratchableMixin(
	foundry.data.ActiveEffectTypeDataModel,
) {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			targetId: new fields.StringField({ initial: "", nullable: false }),
			isScratched: new fields.BooleanField({ initial: false }),
		};
	}

	/**
	 * The Hero this relationship is with, or null once that Hero is gone. The
	 * Hero sheet only lists relationships with a Hero in the world, so a roll
	 * must not offer the others either.
	 * @returns {Actor|null}
	 */
	get targetHero() {
		const actor = game.actors?.get(this.targetId);
		return actor?.type === "hero" ? actor : null;
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

	toTagString(name) {
		return `[${name}]`;
	}
}
