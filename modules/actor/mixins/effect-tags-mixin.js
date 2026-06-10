import { statusTagEffect } from "../../active-effects/effect-factories.js";
import { partitionEffects } from "../../active-effects/effect-queries.js";
import { StatusTagData } from "../../active-effects/status-tag-data.js";

/**
 * Mixin that adds universal tag/status getters to actor data models.
 * Returns ActiveEffect[] directly — no plain object mapping.
 *
 * Subclasses can declare `static extraEffectTypes = [...]` to have additional
 * effect types partitioned in the same single pass over `allApplicableEffects()`.
 * Buckets land in `this._effectBuckets`; expose them via dedicated getters.
 *
 * @param {typeof TypeDataModel} Base
 * @returns {typeof TypeDataModel}
 */
export function EffectTagsMixin(Base) {
	return class extends Base {
		/** Extra effect types to partition. Subclasses override. */
		static extraEffectTypes = [];

		/** @internal Map of effect type → ActiveEffect[], populated in prepareDerivedData. */
		_effectBuckets = {};

		/** @override */
		prepareDerivedData() {
			super.prepareDerivedData();
			this._effectBuckets = partitionEffects(
				this.parent,
				"story_tag",
				"status_tag",
				...this.constructor.extraEffectTypes,
			);
		}

		/**
		 * All story_tag effects on this actor.
		 * @returns {ActiveEffect[]}
		 */
		get storyTags() {
			return this._effectBuckets.story_tag ?? [];
		}

		/**
		 * All status_tag effects on this actor.
		 * @returns {ActiveEffect[]}
		 */
		get statusEffects() {
			return this._effectBuckets.status_tag ?? [];
		}

		/**
		 * Add or stack a status_tag effect on the actor. Canonical entry point for
		 * "this actor gains a status named X at tier T" — used by sheet drops,
		 * action verbs, the token HUD, macros, and any other programmatic path.
		 *
		 * If a status_tag with the same name (case-insensitive) already exists on
		 * this actor or any of its owned items, the existing tiers are advanced
		 * via `calculateMark(markTier)` rather than creating a duplicate.
		 *
		 * @param {string} name
		 * @param {object} [options]
		 * @param {number} [options.tier]       Single tier (1–6); preferred for stacking
		 * @param {boolean[]} [options.tiers]   Full 6-element tiers array; alternative to `tier`
		 * @param {string} [options.img]
		 * @param {boolean} [options.isHidden=false]
		 * @param {string|null} [options.limitId=null]
		 * @returns {Promise<ActiveEffect[]>}
		 */
		async addStatus(
			name,
			{ tier, tiers, img, isHidden = false, limitId = null } = {},
		) {
			const markTier =
				tier ?? (tiers ? Math.max(1, StatusTagData.tierOf(tiers)) : 1);
			const lower = name?.toLowerCase();
			const existing = lower
				? [...this.parent.allApplicableEffects()].find(
						(e) => e.type === "status_tag" && e.name.toLowerCase() === lower,
					)
				: null;
			if (existing) {
				const newTiers = existing.system.calculateMark(markTier);
				return existing.parent.updateEmbeddedDocuments("ActiveEffect", [
					{ _id: existing.id, "system.tiers": newTiers },
				]);
			}
			const data = statusTagEffect({ name, isHidden, limitId });
			if (tiers) data.system.tiers = tiers;
			else if (tier) data.system.tiers = StatusTagData.oneHot(tier);
			if (img) data.img = img;
			return this.parent.createEmbeddedDocuments("ActiveEffect", [data]);
		}

		/**
		 * Add a story_tag effect to this actor.
		 * Default: creates directly on the actor. Override in subclasses to reroute
		 * (e.g. HeroData routes through the backpack item).
		 * @param {object} effectData  Story tag effect creation data
		 * @returns {Promise<ActiveEffect[]|void>}
		 */
		async addStoryTag(effectData) {
			return this.parent.createEmbeddedDocuments("ActiveEffect", [
				{ ...effectData, transfer: false },
			]);
		}

		/**
		 * Remove a status_tag effect by ID.
		 * Finds the effect's actual parent document and deletes from there.
		 * @param {string} effectId
		 * @returns {Promise<ActiveEffect[]>}
		 */
		async removeStatus(effectId) {
			for (const e of this.parent.allApplicableEffects()) {
				if (e.id !== effectId) continue;
				const owner = e.parent;
				return owner.deleteEmbeddedDocuments("ActiveEffect", [effectId]);
			}
		}
	};
}
