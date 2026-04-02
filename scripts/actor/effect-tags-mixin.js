/**
 * Mixin that adds common effect-based getters to actor data models.
 * Provides effectTags, statuses, and storyTags computed from the actor's
 * applicable ActiveEffects. HeroData defines its own versions with
 * fellowship-aware caching.
 *
 * @param {typeof TypeDataModel} Base
 * @returns {typeof TypeDataModel}
 */
export function EffectTagsMixin(Base) {
	return class extends Base {
		/**
		 * All story_tag and status_card effects applicable to this actor.
		 * @returns {ActiveEffect[]}
		 */
		get effectTags() {
			const effects = [];
			for (const effect of this.parent.allApplicableEffects()) {
				if (effect.type === "story_tag" || effect.type === "status_card") {
					effects.push(effect);
				}
			}
			return effects;
		}

		/**
		 * Status card effects formatted for UI display.
		 * Filters hidden statuses for non-GM users.
		 * @returns {object[]}
		 */
		get statuses() {
			return this.effectTags
				.filter((e) => e.type === "status_card")
				.filter((e) => game.user.isGM || !e.system?.isHidden)
				.map((e) => ({
					id: e._id,
					name: e.name,
					type: "status",
					value: e.system.currentTier,
				}));
		}

		/**
		 * Story tag effects formatted for UI display.
		 * Filters hidden tags for non-GM users.
		 * @returns {object[]}
		 */
		get storyTags() {
			return this.effectTags
				.filter((e) => e.type === "story_tag")
				.filter((e) => game.user.isGM || !e.system?.isHidden)
				.map((e) => ({
					id: e._id,
					name: e.name,
					type: "tag",
					isSingleUse: e.system?.isSingleUse ?? false,
					value: 1,
				}));
		}
	};
}
