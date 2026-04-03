export class StatusTagData extends foundry.data.ActiveEffectTypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			isHidden: new fields.BooleanField({ initial: false }),
			tiers: new fields.ArrayField(new fields.BooleanField(), {
				initial: [false, false, false, false, false, false],
				validate: (tiers) => {
					if (tiers.length !== 6)
						throw new foundry.data.validation.DataModelValidationError(
							`tiers must have exactly 6 entries, got ${tiers.length}`,
						);
				},
			}),
			limitId: new fields.StringField({ initial: null, nullable: true }),
		};
	}

	get canBurn() {
		return false;
	}

	get allowedStates() {
		return ",positive,negative";
	}

	get defaultPolarity() {
		return null;
	}

	get currentTier() {
		const lastIndex = this.tiers.lastIndexOf(true);
		return lastIndex === -1 ? 0 : lastIndex + 1;
	}

	get value() {
		return this.currentTier;
	}

	static markTier(tiers, tier) {
		const index = tier - 1;
		if (index < 0 || index >= 6) return [...tiers];

		const newTiers = [...tiers];
		if (!newTiers[index]) {
			newTiers[index] = true;
		} else {
			for (let i = index + 1; i < 6; i++) {
				if (!newTiers[i]) {
					newTiers[i] = true;
					break;
				}
			}
		}
		return newTiers;
	}

	static stackTiers(tierArrays) {
		let combined = [false, false, false, false, false, false];
		for (const tiers of tierArrays) {
			for (let i = 0; i < 6; i++) {
				if (tiers[i]) {
					combined = StatusTagData.markTier(combined, i + 1);
				}
			}
		}
		const lastIndex = combined.lastIndexOf(true);
		return lastIndex === -1 ? 0 : lastIndex + 1;
	}

	calculateMark(tier) {
		return StatusTagData.markTier(this.tiers, tier);
	}

	calculateReduction(amount) {
		const newTiers = Array(6).fill(false);
		for (let i = 0; i < 6; i++) {
			if (this.tiers[i]) {
				const newIndex = i - amount;
				if (newIndex >= 0) {
					newTiers[newIndex] = true;
				}
			}
		}
		return newTiers;
	}
}
