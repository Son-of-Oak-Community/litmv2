import { EffectTagsMixin } from "../effect-tags-mixin.js";
import { ACTOR_TYPES, ITEM_TYPES, THEME_TAG_TYPES } from "../../system/config.js";

export class FellowshipData extends EffectTagsMixin(foundry.abstract.TypeDataModel) {
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
		return this.parent.items.filter((item) => item.type === ITEM_TYPES.story_theme);
	}

	get allTags() {
		return [...this.parent.allApplicableEffects()]
			.filter((e) => THEME_TAG_TYPES.has(e.type));
	}

	/**
	 * All tags applicable to a roll for this fellowship actor.
	 * Returns raw ActiveEffect instances; callers are responsible for mapping to plain objects.
	 * @returns {ActiveEffect[]}
	 */
	get allRollTags() {
		return [
			...this.allTags,
			...this.storyTags,
			...this.statusEffects,
		];
	}

	/**
	 * Summary data for each linked hero in the fellowship.
	 * @returns {object[]}
	 */
	get partyOverview() {
		const fellowshipId = this.parent.id;
		const heroes = game.actors.filter(
			(a) =>
				a.type === ACTOR_TYPES.hero &&
				a.system.fellowshipId === fellowshipId,
		);
		return heroes.map((hero) => {
			const themes = hero.items.filter(
				(i) =>
					i.type === ITEM_TYPES.theme && !i.system.isFellowship && !i.system.isScratched,
			);
			const quests = themes
				.filter((theme) => theme.system.quest?.description)
				.map((theme) => ({
					themeName: theme.name,
					description: theme.system.quest.description,
					milestone: theme.system.quest.tracks.milestone.value,
					abandon: theme.system.quest.tracks.abandon.value,
				}));
			const weaknesses = themes
				.flatMap((theme) => theme.system.weaknessTags)
				.filter((tag) => tag.active && !tag.system.isScratched)
				.map((tag) => tag.name);
			const relationshipTags = hero.system.relationships
				.filter((e) => e.name && !e.system?.isScratched);
			const storyTags = hero.system.backpack
				.filter((e) => e.active && !e.system?.isHidden);
			const statuses = hero.system.statusEffects
				.filter((e) => e.active && (e.system?.currentTier ?? 0) > 0);
			return {
				id: hero.id,
				name: hero.name,
				img: hero.img,
				description: hero.system.description ?? "",
				quests,
				weaknesses,
				relationshipTags,
				storyTags,
				statuses,
				hasTagsOrStatuses: storyTags.length > 0 || statuses.length > 0,
			};
		});
	}

}
