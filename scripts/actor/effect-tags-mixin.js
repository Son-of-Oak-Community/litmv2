import { statusTagEffect, partitionEffects } from "../utils.js";

/**
 * Mixin that adds universal tag/status getters to actor data models.
 * Returns ActiveEffect[] directly — no plain object mapping.
 * @param {typeof TypeDataModel} Base
 * @returns {typeof TypeDataModel}
 */
export function EffectTagsMixin(Base) {
	return class extends Base {
		/** @internal */ _cachedStoryTags = null;
		/** @internal */ _cachedStatusEffects = null;

		/** @override */
		prepareDerivedData() {
			super.prepareDerivedData();
			this._cachedStoryTags = null;
			this._cachedStatusEffects = null;
		}

		/**
		 * All story_tag effects on this actor.
		 * @returns {ActiveEffect[]}
		 */
		get storyTags() {
			if (!this._cachedStoryTags) this.#partitionEffects();
			return this._cachedStoryTags;
		}

		/**
		 * All status_tag effects on this actor.
		 * @returns {ActiveEffect[]}
		 */
		get statusEffects() {
			if (!this._cachedStatusEffects) this.#partitionEffects();
			return this._cachedStatusEffects;
		}

		/**
		 * Create a status_tag effect on the actor.
		 * @param {string} name
		 * @param {object} [options]
		 * @param {boolean[]} [options.tiers]
		 * @param {string} [options.img]
		 * @returns {Promise<ActiveEffect[]>}
		 */
		async addStatus(name, { tiers, img } = {}) {
			const data = statusTagEffect({ name });
			if (tiers) data.system.tiers = tiers;
			if (img) data.img = img;
			return this.parent.createEmbeddedDocuments("ActiveEffect", [data]);
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

		#partitionEffects() {
			const { story_tag, status_tag } = partitionEffects(this.parent, "story_tag", "status_tag");
			this._cachedStoryTags = story_tag;
			this._cachedStatusEffects = status_tag;
		}
	};
}
