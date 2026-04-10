import { EffectTagsMixin } from "../effect-tags-mixin.js";
import { THEME_TAG_TYPES } from "../../system/config.js";

export class FellowshipData extends EffectTagsMixin(foundry.abstract.TypeDataModel) {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			description: new fields.HTMLField({ initial: "" }),
		};
	}

	get theme() {
		return this.parent.items.find(
			(item) => item.type === "theme" && item.system.isFellowship,
		);
	}

	get storyThemes() {
		return this.parent.items.filter((item) => item.type === "story_theme");
	}

	get allTags() {
		return [...this.parent.allApplicableEffects()]
			.filter((e) => THEME_TAG_TYPES.has(e.type));
	}

	async scratchTag(_tagType, tagId) {
		for (const e of this.parent.allApplicableEffects()) {
			if (e.id === tagId) {
				await e.system.toggleScratch();
				return;
			}
		}
	}
}
