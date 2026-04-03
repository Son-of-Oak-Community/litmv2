export class WeaknessTagData extends foundry.data.ActiveEffectTypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			question: new fields.StringField({ initial: null, nullable: true, blank: true }),
		};
	}

	get canBurn() {
		return false;
	}

	get allowedStates() {
		return ",negative,positive";
	}

	get defaultPolarity() {
		return -1;
	}
}
