export class WeaknessTagData extends foundry.data.ActiveEffectTypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			question: new fields.StringField({
				initial: null,
				nullable: true,
				blank: true,
			}),
		};
	}

	get canBurn() {
		return false;
	}

	get allowedStates() {
		// GM-side cycle. The "positive" flip is the Narrator-only inversion
		// (Core Book p.76) and only the GM ever reaches it.
		return ",negative,positive";
	}

	get playerAllowedStates() {
		// Players can only invoke a weakness as the hindrance it is.
		return ",negative";
	}

	get defaultPolarity() {
		return -1;
	}

	toTagString(name) {
		return `[${name}]`;
	}
}
