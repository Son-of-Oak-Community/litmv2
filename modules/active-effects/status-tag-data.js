import { maxStatusTier, padTiers } from "./status-tiers.js";

// Re-exported so `status-tag-data.js` stays the one import site for tier
// semantics; `status-tiers.js` exists only to keep the primitives free of
// `foundry.*` for Foundry-free callers (the camping data layer).
export {
	clampTier,
	maxStatusTier,
	padTiers,
	RAW_MAX_STATUS_TIER,
} from "./status-tiers.js";

export class StatusTagData extends foundry.data.ActiveEffectTypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			isHidden: new fields.BooleanField({ initial: false }),
			// Length is the world's track depth, not a fixed 6 — a function so
			// it is evaluated per-instantiation, after CONFIG exists.
			tiers: new fields.ArrayField(new fields.BooleanField(), {
				initial: () => Array(maxStatusTier()).fill(false),
			}),
			limitId: new fields.StringField({ initial: null, nullable: true }),
		};
	}

	/**
	 * Widen the stored track to this world's depth. Effects authored under a
	 * shallower ceiling — legacy worlds, compendium content, converter output
	 * — therefore need no migration: they read as full-length here and the
	 * longer array reaches storage on the next write.
	 * @override
	 */
	prepareDerivedData() {
		super.prepareDerivedData();
		this.tiers = padTiers(this.tiers);
	}

	/** How many boxes this particular status has. */
	get trackLength() {
		return this.tiers.length;
	}

	get canBurn() {
		return false;
	}

	// Negative-first: statuses are usually hindrances (wounded, exhausted),
	// so the first click selects the hindering polarity everywhere a status
	// chip is cycled — roll dialog, hero sheet, ally and scene groups alike.
	get allowedStates() {
		return ",negative,positive";
	}

	get defaultPolarity() {
		return null;
	}

	/**
	 * The highest marked tier in a boolean `tiers` array (1-based),
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

	/**
	 * A tiers array with exactly the given tier (1-based) marked, sized to the
	 * world's track depth. Tiers outside the track — including above it, which
	 * would put a status past the tier that kills — yield an all-false
	 * (tier-less) array.
	 * @param {number} tier
	 * @param {number} [length]
	 * @returns {boolean[]}
	 */
	static oneHot(tier, length = maxStatusTier()) {
		return Array.from({ length }, (_, i) => i + 1 === tier);
	}

	/**
	 * Toggle a single tier box (1-based) and persist to the owning effect.
	 * @param {number} tier
	 * @param {object} [options]
	 * @param {boolean} [options.deleteOnEmpty=false]
	 *        Delete the effect when no tier remains marked (token HUD /
	 *        spend-power policy) instead of keeping a tier-less status
	 *        (sheet / sidebar policy).
	 * @returns {Promise<ActiveEffect|void>}
	 */
	async toggleTier(tier, { deleteOnEmpty = false } = {}) {
		const index = tier - 1;
		if (index < 0 || index >= this.trackLength) return;
		const newTiers = [...this.tiers];
		newTiers[index] = !newTiers[index];
		return this.#persistTiers(newTiers, deleteOnEmpty);
	}

	/**
	 * Reduce all marked tiers by `amount` and persist to the owning effect.
	 * No-op when nothing is marked.
	 * @param {number} [amount=1]
	 * @param {object} [options]
	 * @param {boolean} [options.deleteOnEmpty=false]  See {@link toggleTier}.
	 * @returns {Promise<ActiveEffect|void>}
	 */
	async reduceTier(amount = 1, { deleteOnEmpty = false } = {}) {
		if (!this.tiers.some(Boolean)) return;
		return this.#persistTiers(this.calculateReduction(amount), deleteOnEmpty);
	}

	async #persistTiers(newTiers, deleteOnEmpty) {
		if (deleteOnEmpty && !newTiers.some(Boolean)) return this.parent.delete();
		return this.parent.update({ "system.tiers": newTiers });
	}

	/**
	 * Mark `tier` (1-based), spilling right into the first free box when it is
	 * already marked — the Core Book's stacking rule (p.167). The track first
	 * grows to this world's depth, so marking tier 8 on an effect still stored
	 * with six boxes widens it rather than dropping the mark; a tier beyond
	 * the world's depth is still refused.
	 * @param {boolean[]} tiers
	 * @param {number} tier
	 * @returns {boolean[]}
	 */
	static markTier(tiers, tier) {
		const index = tier - 1;
		if (index < 0) return [...tiers];

		const newTiers = padTiers(tiers);
		if (index >= newTiers.length) return newTiers;

		if (!newTiers[index]) {
			newTiers[index] = true;
		} else {
			for (let i = index + 1; i < newTiers.length; i++) {
				if (!newTiers[i]) {
					newTiers[i] = true;
					break;
				}
			}
		}
		return newTiers;
	}

	/**
	 * The tier several stacked status tracks add up to — each mark from every
	 * input folded into one track, spilling right as it goes.
	 * @param {boolean[][]} tierArrays
	 * @returns {number}
	 */
	static stackedTier(tierArrays) {
		const length = tierArrays.reduce(
			(longest, tiers) => Math.max(longest, tiers?.length ?? 0),
			maxStatusTier(),
		);
		let combined = Array(length).fill(false);
		for (const tiers of tierArrays) {
			for (let i = 0; i < (tiers?.length ?? 0); i++) {
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
		const newTiers = Array(this.trackLength).fill(false);
		for (let i = 0; i < this.trackLength; i++) {
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
