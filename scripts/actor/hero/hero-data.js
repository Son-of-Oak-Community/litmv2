import { detectTrackCompletion, buildTrackCompleteContent } from "../../system/chat.js";
import { LitmSettings } from "../../system/settings.js";
import { THEME_TAG_TYPES } from "../../system/config.js";
import { resolveEffect } from "../../utils.js";
import { EffectTagsMixin } from "../effect-tags-mixin.js";

/**
 * Build ActiveEffect creation data from legacy relationship arrays.
 * Shared by createLegacyRelationshipEffects and the world migration.
 * @param {object[]} relationships - Array of { tag, actorId, isScratched }
 * @returns {object[]}
 */
export function buildRelationshipEffects(relationships) {
	return relationships
		.filter((r) => r.tag && r.actorId)
		.map((r) => ({
			name: r.tag,
			type: "relationship_tag",
			system: { targetId: r.actorId, isScratched: r.isScratched ?? false },
		}));
}

/**
 * Create relationship_tag effects from stashed legacy data after actor creation.
 * @param {Actor} actor
 */
export async function createLegacyRelationshipEffects(actor) {
	if (actor.type !== "hero") return;
	const rels = actor.getFlag("litmv2", "legacyRelationships");
	if (!Array.isArray(rels) || !rels.length) return;
	if (actor.effects.some((e) => e.type === "relationship_tag")) return;

	const effectData = buildRelationshipEffects(rels);
	if (effectData.length) {
		await actor.createEmbeddedDocuments("ActiveEffect", effectData);
	}
	const { ForcedDeletion } = foundry.data.operators;
	await actor.update({
		system: { relationships: new ForcedDeletion() },
		flags: { litmv2: { legacyRelationships: new ForcedDeletion() } },
	});
}

export class HeroData extends EffectTagsMixin(foundry.abstract.TypeDataModel) {
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
				value: new fields.NumberField({ initial: 5, integer: true }),
				max: new fields.NumberField({ initial: 5, integer: true }),
			}),
		};
	}

	static migrateData(source) {
		const relationships = source.relationships;
		if (Array.isArray(relationships) && relationships.length) {
			source.flags ??= {};
			source.flags.litmv2 ??= {};
			source.flags.litmv2.legacyRelationships = relationships;
		}
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
		if (!LitmSettings.useFellowship) return null;
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
					.filter((e) => THEME_TAG_TYPES.has(e.type))
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

	get backpackItem() {
		return this.parent.items.find((i) => i.type === "backpack") ?? null;
	}

	get backpack() {
		return this.backpackItem?.system.tags ?? [];
	}

	/**
	 * Everything from the fellowship actor: theme groups + story tags/statuses.
	 * @returns {{ themes: { theme: Item, tags: ActiveEffect[] }[], tags: ActiveEffect[] }}
	 */
	get fellowship() {
		const actor = this.fellowshipActor;
		if (!actor) return { themes: [], tags: [] };
		const themeMap = new Map();
		const tags = [];
		for (const e of actor.allApplicableEffects()) {
			if (THEME_TAG_TYPES.has(e.type)) {
				const item = e.parent;
				if (!item || item === actor) continue;
				if (!themeMap.has(item.id)) themeMap.set(item.id, { theme: item, tags: [] });
				themeMap.get(item.id).tags.push(e);
			} else if (e.type === "story_tag" || e.type === "status_tag") {
				tags.push(e);
			}
		}
		const themes = [...themeMap.values()].map(({ theme, tags: t }) => ({
			theme,
			tags: t.sort((a, b) => (b.system.isTitleTag ? 1 : 0) - (a.system.isTitleTag ? 1 : 0)),
		}));
		return { themes, tags };
	}

	/**
	 * Relationship tag AEs on the hero.
	 * @returns {ActiveEffect[]}
	 */
	get relationships() {
		return [...this.parent.allApplicableEffects()]
			.filter((e) => e.type === "relationship_tag");
	}

	/**
	 * All status_tag effects applicable to this hero.
	 * @returns {ActiveEffect[]}
	 */
	get statuses() {
		return [...this.parent.allApplicableEffects()]
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
	 * All scratched AEs across hero + fellowship.
	 * @returns {ActiveEffect[]}
	 */
	get scratchedTags() {
		const scratched = [];
		for (const e of this.parent.allApplicableEffects()) {
			if (e.system?.isScratched && e.type !== "weakness_tag" && e.type !== "status_tag") {
				scratched.push(e);
			}
		}
		const fellowship = this.fellowshipActor;
		if (fellowship) {
			for (const e of fellowship.allApplicableEffects()) {
				if (e.system?.isScratched && e.type !== "weakness_tag" && e.type !== "status_tag") {
					scratched.push(e);
				}
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
		return resolveEffect(effectId, this.parent);
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
		const baseLimit = LitmSettings?.heroLimit ?? 5;
		const highestStatus = this.statuses
			.filter((e) => e.active)
			.reduce((max, e) => Math.max(max, e.system.currentTier), 0);
		this.limit.value = baseLimit - highestStatus;
		this.limit.max = baseLimit;
	}
}
