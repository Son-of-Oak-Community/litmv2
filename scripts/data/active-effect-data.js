/**
 * Schema for the `changes` array required by Foundry's ActiveEffect contract.
 * Shared by all typed ActiveEffect data models.
 */
function changesSchema() {
	const fields = foundry.data.fields;
	return new fields.ArrayField(
		new fields.SchemaField({
			type: new fields.StringField({ required: true, blank: false }),
			phase: new fields.StringField({ required: true, blank: false }),
			key: new fields.StringField({ required: true, blank: false }),
			value: new fields.StringField({ required: true, blank: false }),
			mode: new fields.NumberField({ integer: true, initial: 2 }),
			priority: new fields.NumberField(),
		}),
		{ initial: [] },
	);
}

export class StoryTagData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			isSingleUse: new fields.BooleanField({ initial: false }),
			isScratched: new fields.BooleanField({ initial: false }),
			isHidden: new fields.BooleanField({ initial: false }),
			limitId: new fields.StringField({ initial: null, nullable: true }),
			changes: changesSchema(),
		};
	}

	get isSuppressed() {
		return this.isScratched;
	}
}

export class ThemeTagData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			tagType: new fields.StringField({
				required: true,
				choices: ["powerTag", "weaknessTag"],
				initial: "powerTag",
			}),
			question: new fields.StringField({
				initial: null,
				nullable: true,
				blank: true,
			}),
			isScratched: new fields.BooleanField({ initial: false }),
			isSingleUse: new fields.BooleanField({ initial: false }),
			changes: changesSchema(),
		};
	}

	get isSuppressed() {
		return this.isScratched;
	}
}

export class StatusCardData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
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
			changes: changesSchema(),
		};
	}

	get currentTier() {
		// Find the index of the highest marked box (0-indexed) + 1.
		// If no boxes are marked, return 0.
		// Logic: 6 - (index of first true from the end?) or just findLastIndex
		const lastIndex = this.tiers.lastIndexOf(true);
		return lastIndex === -1 ? 0 : lastIndex + 1;
	}

	get value() {
		return this.currentTier;
	}

	/**
	 * Mark a specific tier on a tiers array (pure function).
	 * If the target slot is occupied, bump to the next empty slot.
	 * @param {boolean[]} tiers - 6-element boolean array
	 * @param {number} tier - The tier to mark (1-6)
	 * @returns {boolean[]} New tiers array
	 */
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

	/**
	 * Stack multiple status tier arrays into a combined tier value.
	 * Each marked box is applied via markTier onto a cumulative card.
	 * @param {boolean[][]} tierArrays - Array of 6-element boolean arrays
	 * @returns {number} Combined tier (0-6)
	 */
	static stackTiers(tierArrays) {
		let combined = [false, false, false, false, false, false];
		for (const tiers of tierArrays) {
			for (let i = 0; i < 6; i++) {
				if (tiers[i]) {
					combined = StatusCardData.markTier(combined, i + 1);
				}
			}
		}
		const lastIndex = combined.lastIndexOf(true);
		return lastIndex === -1 ? 0 : lastIndex + 1;
	}

	/**
	 * Mark a specific tier (box).
	 * Implements the stacking rule: If box N is already marked, mark box N+1.
	 * @param {number} tier - The tier to mark (1-6)
	 * @returns {boolean[]} New tiers array
	 */
	calculateMark(tier) {
		return StatusCardData.markTier(this.tiers, tier);
	}

	/**
	 * Reduce the status by shifting marks left.
	 * @param {number} amount - Amount to reduce
	 * @returns {boolean[]} New tiers array
	 */
	calculateReduction(amount) {
		// Shift all marks left by amount
		// e.g. [T, F, T, F, F, F] reduce 1 -> [F, T, F, F, F, F] -> [T, F, F, F, F, F] (shifted left)
		// Wait, "Shift left" usually means moving indices 1->0, 2->1.
		// So [T, F, T] reduce 1 -> [F, T, F] (index 1 moves to 0, index 2 moves to 1)
		// Let's implement this: indices i become i-amount. If i-amount < 0, it drops off.

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
