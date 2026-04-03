/**
 * Mixin that adds universal tag/status getters to actor data models.
 * Returns ActiveEffect[] directly — no plain object mapping.
 * @param {typeof TypeDataModel} Base
 * @returns {typeof TypeDataModel}
 */
export function EffectTagsMixin(Base) {
	return class extends Base {
		/**
		 * All story_tag effects on this actor.
		 * @returns {ActiveEffect[]}
		 */
		get storyTags() {
			const { storyTags } = this.#partitionEffects();
			return storyTags;
		}

		/**
		 * All status_tag effects on this actor.
		 * @returns {ActiveEffect[]}
		 */
		get statusEffects() {
			const { statusEffects } = this.#partitionEffects();
			return statusEffects;
		}

		#partitionEffects() {
			const storyTags = [];
			const statusEffects = [];
			for (const e of this.parent.allApplicableEffects()) {
				if (e.type === "story_tag") storyTags.push(e);
				else if (e.type === "status_tag") statusEffects.push(e);
			}
			return { storyTags, statusEffects };
		}
	};
}
