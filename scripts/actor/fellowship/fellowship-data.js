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
		const theme = this.theme;
		const themeTags = theme ? theme.system.allTags : [];
		const storyTags = this.storyThemes.flatMap((item) => item.system.allTags);
		return [...themeTags, ...storyTags];
	}

	/**
	 * Toggle scratch state of a tag on this fellowship actor.
	 * @param {string} tagType   The tag type (powerTag, themeTag, weaknessTag)
	 * @param {string} tagId     The tag ID (may be empty for legacy data)
	 * @param {string} [tagName] Tag name fallback for legacy data without persisted IDs
	 */
	async scratchTag(tagType, tagId, tagName) {
		if (tagType === "themeTag") {
			const theme = this.parent.items.get(tagId);
			if (!theme) return;
			await theme.update({ "system.isScratched": !theme.system.isScratched });
			return;
		}

		const tagArrayKey =
			tagType === "weaknessTag" ? "weaknessTags" : "powerTags";
		const match = (t) =>
			(tagId && t.id === tagId) || (tagName && t.name === tagName);

		const parentItem = this.parent.items.find(
			(i) =>
				["theme", "story_theme"].includes(i.type) &&
				i.system[tagArrayKey]?.some(match),
		);
		if (!parentItem) return;

		const isStoryTheme = parentItem.type === "story_theme";
		const raw = parentItem.system.toObject();
		const tags = isStoryTheme ? raw.theme[tagArrayKey] : raw[tagArrayKey];
		const systemPath = isStoryTheme
			? `system.theme.${tagArrayKey}`
			: `system.${tagArrayKey}`;
		const tag = tags.find(match);
		if (!tag?.isActive) return;

		tag.isScratched = !tag.isScratched;
		await parentItem.update({ [systemPath]: tags });
	}
}
