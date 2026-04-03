import { EffectTagsMixin } from "../effect-tags-mixin.js";

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
		const items = [this.theme, ...this.storyThemes].filter(Boolean);
		return items.flatMap((item) => [...item.effects]
			.filter((e) => e.type === "power_tag" || e.type === "weakness_tag" || e.type === "fellowship_tag")
		);
	}

	async scratchTag(_tagType, tagId) {
		for (const item of this.parent.items) {
			const effect = item.effects.get(tagId);
			if (effect) {
				await effect.system.toggleScratch();
				return;
			}
		}
	}
}
