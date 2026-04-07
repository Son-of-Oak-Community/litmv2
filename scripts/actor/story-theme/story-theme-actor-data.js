import { EffectTagsMixin } from "../effect-tags-mixin.js";

export class StoryThemeActorData extends EffectTagsMixin(
	foundry.abstract.TypeDataModel,
) {
	static defineSchema() {
		return {};
	}

	/**
	 * The single embedded story_theme item this actor wraps.
	 * @returns {Item|null}
	 */
	get storyTheme() {
		return this.parent.items.find((i) => i.type === "story_theme") ?? null;
	}
}
