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

	/**
	 * The highest marked tier in a 6-slot boolean `tiers` array (1-based),
	 * or 0 when nothing is marked / the input isn't an array. This is the
	 * single source for the `lastIndexOf(true) + 1` primitive reused across
	 * renderers, chat actions, the roll dialog, camping, and spend-power.
	 * @param {boolean[]} tiers
	 * @returns {number}
	 */
	static tierOf(tiers) {
		return Array.isArray(tiers) ? tiers.lastIndexOf(true) + 1 : 0;
	}

	get currentTier() {
		return StatusTagData.tierOf(this.tiers);
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

	static stackedTier(tierArrays) {
		let combined = [false, false, false, false, false, false];
		for (const tiers of tierArrays) {
			for (let i = 0; i < 6; i++) {
				if (tiers[i]) {
					combined = StatusTagData.markTier(combined, i + 1);
				}
			}
		}
		return StatusTagData.tierOf(combined);
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

	toTagString(name) {
		const tier = this.currentTier ?? 0;
		return `[${name}-${tier}]`;
	}

	static toDragMarkup({ name, value }) {
		return `[${name}-${value ?? ""}]`;
	}
}
