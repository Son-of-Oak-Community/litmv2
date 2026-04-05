import { detectTrackCompletion, buildTrackCompleteContent } from "../../system/chat.js";

export class HeroData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			description: new fields.HTMLField({ initial: "" }),
			promise: new fields.NumberField({
				initial: 0,
				min: 0,
				max: 5,
				integer: true,
			}),
			mof: new fields.ArrayField(
				new fields.SchemaField({
					name: new fields.StringField({ initial: "" }),
					description: new fields.HTMLField({ initial: "" }),
				}),
				{ initial: [] },
			),
			fellowshipId: new fields.StringField({ initial: "" }),
			limit: new fields.SchemaField({
				value: new fields.NumberField({ initial: 6, integer: true }),
				max: new fields.NumberField({ initial: 6, integer: true }),
			}),
		};
	}

	static migrateData(source) {
		delete source.relationships;
		return super.migrateData(source);
	}

	static getTrackableAttributes() {
		return {
			bar: ["limit"],
			value: [],
		};
	}

	get fellowshipActor() {
		if (this.fellowshipId) {
			const actor = game.actors.get(this.fellowshipId);
			if (actor) return actor;
		}
		// Fallback to the global singleton
		return game.litmv2?.fellowship ?? null;
	}

	/**
	 * Own non-fellowship themes, each with their tag AEs.
	 * @returns {{ theme: Item, tags: ActiveEffect[] }[]}
	 */
	get themes() {
		return this.parent.items
			.filter((i) => (i.type === "theme" && !i.system.isFellowship) || i.type === "story_theme")
			.sort((a, b) => a.sort - b.sort)
			.map((theme) => ({
				theme,
				tags: [...theme.effects]
					.filter((e) => e.type === "power_tag" || e.type === "weakness_tag" || e.type === "fellowship_tag")
					.sort((a, b) => (b.system.isTitleTag ? 1 : 0) - (a.system.isTitleTag ? 1 : 0)),
			}));
	}

	/**
	 * All story_tag effects applicable to this hero (from backpack transfer).
	 * Compatible with the EffectTagsMixin interface.
	 * @returns {ActiveEffect[]}
	 */
	get storyTags() {
		return [...this.parent.allApplicableEffects()]
			.filter((e) => e.type === "story_tag");
	}

	get backpack() {
		const backpack = this.parent.items.find((i) => i.type === "backpack");
		if (!backpack) return [];
		return backpack.system.tags;
	}

	/**
	 * Everything from the fellowship actor: theme groups + story tags/statuses.
	 * @returns {{ themes: { theme: Item, tags: ActiveEffect[] }[], tags: ActiveEffect[] }}
	 */
	get fellowship() {
		const actor = this.fellowshipActor;
		if (!actor) return { themes: [], tags: [] };
		const themes = actor.items
			.filter((i) => i.type === "theme" || i.type === "story_theme")
			.map((theme) => ({
				theme,
				tags: [...theme.effects]
					.filter((e) => e.type === "power_tag" || e.type === "weakness_tag" || e.type === "fellowship_tag")
					.sort((a, b) => (b.system.isTitleTag ? 1 : 0) - (a.system.isTitleTag ? 1 : 0)),
			}));
		const tags = [...actor.allApplicableEffects()]
			.filter((e) => e.type === "story_tag" || e.type === "status_tag");
		return { themes, tags };
	}

	/**
	 * Relationship tag AEs on the hero.
	 * @returns {ActiveEffect[]}
	 */
	get relationships() {
		return [...this.parent.effects]
			.filter((e) => e.type === "relationship_tag");
	}

	/**
	 * Status tag AEs on the hero actor only (not fellowship).
	 * Overrides the mixin — hero statuses are actor-direct only.
	 * @returns {ActiveEffect[]}
	 */
	get statuses() {
		return [...this.parent.effects]
			.filter((e) => e.type === "status_tag");
	}

	get statusEffects() {
		return this.statuses;
	}

	get relationshipEntries() {
		const heroActors = (game.actors ?? []).filter(
			(actor) => actor.type === "hero" && actor.id !== this.parent.id,
		);
		const existing = this.relationships;
		return heroActors
			.map((actor) => {
				const effect = existing.find((e) => e.system.targetId === actor.id);
				return {
					actorId: actor.id,
					name: actor.name,
					img: actor.img,
					tag: effect?.name ?? "",
					isScratched: effect?.system?.isScratched ?? false,
					effectId: effect?.id ?? null,
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * All scratched AEs across hero + fellowship items.
	 * @returns {ActiveEffect[]}
	 */
	get scratchedTags() {
		const scratched = [];
		const itemSources = [...this.parent.items];
		const fellowship = this.fellowshipActor;
		if (fellowship) itemSources.push(...fellowship.items);
		for (const item of itemSources) {
			for (const effect of item.effects) {
				if (effect.system?.isScratched && effect.type !== "weakness_tag") {
					scratched.push(effect);
				}
			}
		}
		for (const effect of this.parent.effects) {
			if (effect.system?.isScratched && effect.type !== "status_tag") {
				scratched.push(effect);
			}
		}
		return scratched;
	}

	/**
	 * Toggle scratch state of a tag.
	 * @param {object} tag  Tag object with at least `id`
	 */
	async toggleScratchTag(tag) {
		if (Hooks.call("litm.preTagScratched", this.parent, tag) === false) return;
		const effect = this.#findEffect(tag.id);
		if (!effect) return;
		await effect.system.toggleScratch();
		Hooks.callAll("litm.tagScratched", this.parent, tag);
	}

	#findEffect(effectId) {
		for (const effect of this.parent.allApplicableEffects()) {
			if (effect.id === effectId) return effect;
		}
		const fellowship = this.fellowshipActor;
		if (fellowship) {
			for (const item of fellowship.items) {
				const effect = item.effects.get(effectId);
				if (effect) return effect;
			}
		}
		return null;
	}

	/**
	 * Gain improvement from using a weakness tag or relationship tag as negative.
	 * Resolves the effect by UUID to trace it back to its parent theme.
	 * @param {object} tag  The tag with `uuid` and `type`
	 */
	async gainImprovement(tag) {
		// Relationship tags always improve the fellowship theme
		if (tag.type === "relationship_tag") {
			const fellowship = this.fellowshipActor;
			if (!fellowship) return;
			const theme = fellowship.items.find(
				(i) => i.type === "theme" && i.system.isFellowship,
			);
			if (!theme) return;
			const newValue = theme.system.improve.value + 1;
			await fellowship.updateEmbeddedDocuments("Item", [
				{ _id: theme.id, "system.improve.value": newValue },
			]);
			await this.#notifyTrackCompletion(theme, fellowship, newValue);
			return;
		}

		// Trace effect → parent theme → owner actor via UUID
		if (!tag.uuid) return;
		const effect = await foundry.utils.fromUuid(tag.uuid);
		if (!effect) return;
		const parentTheme = effect.parent;
		if (!parentTheme || !["theme", "story_theme"].includes(parentTheme.type)) return;
		const owner = parentTheme.parent;
		if (!owner) return;
		const newValue = parentTheme.system.improve.value + 1;
		await owner.updateEmbeddedDocuments("Item", [
			{ _id: parentTheme.id, "system.improve.value": newValue },
		]);
		await this.#notifyTrackCompletion(parentTheme, owner, newValue);
	}

	async #notifyTrackCompletion(theme, actor, newValue) {
		const trackInfo = detectTrackCompletion("system.improve.value", newValue, theme, actor);
		if (!trackInfo) return;
		await foundry.documents.ChatMessage.create({
			content: buildTrackCompleteContent(trackInfo),
			speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
		});
	}

	getRollData() {
		const allThemeTags = this.themes.flatMap((g) => g.tags);
		return {
			promise: this.promise,
			limit: this.limit.value,
			limitMax: this.limit.max,
			power: allThemeTags.filter((e) => e.type !== "weakness_tag" && e.active).length,
			weakness: allThemeTags.filter((e) => e.type === "weakness_tag" && e.active).length,
		};
	}

	prepareDerivedData() {
		super.prepareDerivedData();
		const highestStatus = this.statuses
			.filter((e) => e.active)
			.reduce((max, e) => Math.max(max, e.system.currentTier), 0);
		this.limit.value = this.limit.max - highestStatus;
	}
}
