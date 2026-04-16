import { detectTrackCompletion } from "../../system/chat.js";
import { LitmSettings } from "../../system/settings.js";
import { ACTOR_TAG_TYPES, ACTOR_TYPES, EFFECT_TYPES, ITEM_TYPES, POWER_TAG_TYPES, THEME_TAG_TYPES } from "../../system/config.js";
import { partitionEffects } from "../../utils.js";
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
			type: EFFECT_TYPES.relationship_tag,
			system: { targetId: r.actorId, isScratched: r.isScratched ?? false },
		}));
}

/**
 * Create relationship_tag effects from stashed legacy data after actor creation.
 * @param {Actor} actor
 */
export async function createLegacyRelationshipEffects(actor) {
	if (actor.type !== ACTOR_TYPES.hero) return;
	const rels = actor.getFlag("litmv2", "legacyRelationships");
	if (!Array.isArray(rels) || !rels.length) return;
	if (actor.effects.some((e) => e.type === EFFECT_TYPES.relationship_tag)) return;

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

/**
 * Mark improvement on the theme that owns the given tag effect.
 * @param {Actor} actor - The hero actor
 * @param {object} tag - Tag object with uuid and type properties
 * @returns {Promise<{theme: Item, actor: Actor, trackInfo: object}|null>} Track completion data or null
 */
export async function gainImprovement(actor, tag) {
	// Relationship tags always improve the fellowship theme
	if (tag.type === EFFECT_TYPES.relationship_tag) {
		const fellowship = actor.system.fellowshipActor;
		if (!fellowship) return null;
		const theme = fellowship.items.find(
			(i) => i.type === ITEM_TYPES.theme && i.system.isFellowship,
		);
		if (!theme) return null;
		const newValue = theme.system.improve.value + 1;
		await fellowship.updateEmbeddedDocuments("Item", [
			{ _id: theme.id, "system.improve.value": newValue },
		]);
		return detectTrackCompletion("system.improve.value", newValue, theme, fellowship);
	}

	// Trace effect → parent theme → owner actor via UUID
	if (!tag.uuid) return null;
	const effect = await foundry.utils.fromUuid(tag.uuid);
	if (!effect) return null;
	const parentTheme = effect.parent;
	if (!parentTheme || ![ITEM_TYPES.theme, ITEM_TYPES.story_theme].includes(parentTheme.type)) return null;
	const owner = parentTheme.parent;
	if (!owner) return null;
	const newValue = parentTheme.system.improve.value + 1;
	await owner.updateEmbeddedDocuments("Item", [
		{ _id: parentTheme.id, "system.improve.value": newValue },
	]);
	return detectTrackCompletion("system.improve.value", newValue, parentTheme, owner);
}

/**
 * Apply the consequence of a sacrifice roll to a hero's theme.
 * @param {Actor} actor - The hero actor
 * @param {string} themeId - The sacrificed theme's ID
 * @param {string} level - "painful" or "scarring"
 */
export async function applyThemeSacrifice(actor, themeId, level) {
	const theme = actor.items.get(themeId);
	if (!theme) return;
	const themeName = theme.name;

	if (level === "painful") {
		const powerEffects = theme.effects.filter(
			(e) => POWER_TAG_TYPES.has(e.type),
		);
		if (powerEffects.length) {
			await theme.updateEmbeddedDocuments(
				"ActiveEffect",
				powerEffects.map((e) => ({ _id: e.id, "system.isScratched": true })),
			);
		}
		await actor.updateEmbeddedDocuments("Item", [
			{ _id: theme.id, "system.isScratched": true },
		]);
		ui.notifications.info(
			game.i18n.format("LITM.Ui.sacrifice_theme_scratched", { theme: themeName }),
		);
	} else if (level === "scarring") {
		await actor.deleteEmbeddedDocuments("Item", [theme.id]);
		ui.notifications.info(
			game.i18n.format("LITM.Ui.sacrifice_theme_removed", { theme: themeName }),
		);
	}
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

	/** @type {ActiveEffect[]} Cached relationship_tag effects */
	_relationships = [];

	/**
	 * Single-pass partition of allApplicableEffects into the mixin's story/status
	 * buckets plus a local relationships bucket. Called once per prepareDerivedData cycle.
	 */
	#partitionAllEffects() {
		const { story_tag, status_tag, relationship_tag } = partitionEffects(
			this.parent, "story_tag", "status_tag", "relationship_tag",
		);
		this._cachedStoryTags = story_tag;
		this._cachedStatusEffects = status_tag;
		this._relationships = relationship_tag;
	}

	get backpackItem() {
		return this.parent.items.find((i) => i.type === "backpack") ?? null;
	}

	get backpack() {
		return this.backpackItem?.system.tags ?? [];
	}

	/**
	 * Everything from the fellowship actor: theme groups + story tags/statuses.
	 * Uses the fellowship actor's allApplicableEffects (separate document, not cached here).
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
			} else if (ACTOR_TAG_TYPES.has(e.type)) {
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
		return this._relationships;
	}


	/**
	 * All tags applicable to a roll for this hero, including fellowship tags when enabled.
	 * Returns raw ActiveEffect instances; callers are responsible for mapping to plain objects.
	 * @returns {ActiveEffect[]}
	 */
	get allRollTags() {
		const tags = [
			...this.themes.flatMap((g) => g.tags),
			...this.storyTags,
			...this.statusEffects,
		];
		if (LitmSettings.useFellowship) {
			tags.push(
				...this.fellowship.themes.flatMap((g) => g.tags),
				...this.fellowship.tags,
				...this.relationships.filter((e) => e.name),
			);
		}
		return tags;
	}

	/**
	 * All scratched AEs across hero + fellowship.
	 * @returns {ActiveEffect[]}
	 */
	get scratchedTags() {
	const isScratchedPlayTag = (e) => e.system?.isScratched && e.type !== EFFECT_TYPES.weakness_tag && e.type !== EFFECT_TYPES.status_tag;
	const scratched = [...this.parent.allApplicableEffects()].filter(isScratchedPlayTag);
	const fellowship = this.fellowshipActor;
	if (fellowship) {
		scratched.push(...[...fellowship.allApplicableEffects()].filter(isScratchedPlayTag));
	}
	return scratched;
}

	getRollData() {
		const allThemeTags = this.themes.flatMap((g) => g.tags);
		return {
			promise: this.promise,
			limit: this.limit.value,
			limitMax: this.limit.max,
			power: allThemeTags.filter((e) => e.type !== EFFECT_TYPES.weakness_tag && e.active).length,
			weakness: allThemeTags.filter((e) => e.type === EFFECT_TYPES.weakness_tag && e.active).length,
		};
	}

	prepareDerivedData() {
		super.prepareDerivedData();
		this.#partitionAllEffects();
		const baseLimit = LitmSettings?.heroLimit ?? 5;
		const highestStatus = this._cachedStatusEffects
			.filter((e) => e.active)
			.reduce((max, e) => Math.max(max, e.system.currentTier), 0);
		this.limit.value = baseLimit - highestStatus;
		this.limit.max = baseLimit;
	}
}
