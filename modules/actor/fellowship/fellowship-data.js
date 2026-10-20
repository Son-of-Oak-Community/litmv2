import { ITEM_TYPES, THEME_TAG_TYPES } from "../../system/config.js";
import { EffectTagsMixin } from "../mixins/effect-tags-mixin.js";

export class FellowshipData extends EffectTagsMixin(
	foundry.abstract.TypeDataModel,
) {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			description: new fields.HTMLField({ initial: "" }),
		};
	}

	get theme() {
		return this.parent.items.find(
			(item) => item.type === ITEM_TYPES.theme && item.system.isFellowship,
		);
	}

	get storyThemes() {
		return this.parent.items.filter(
			(item) => item.type === ITEM_TYPES.story_theme,
		);
	}

	get allTags() {
		return [...this.parent.allApplicableEffects()].filter((e) =>
			THEME_TAG_TYPES.has(e.type),
		);
	}

	/**
	 * All tags applicable to a roll for this fellowship actor.
	 * Returns raw ActiveEffect instances; callers are responsible for mapping to plain objects.
	 * @returns {ActiveEffect[]}
	 */
	get allRollTags() {
		return [...this.allTags, ...this.storyTags, ...this.statusEffects];
	}
}
