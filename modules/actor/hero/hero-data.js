import { dedupeTitleTags } from "../../active-effects/effect-queries.js";
import { completeTrackUpdate, fireTrackCompletion } from "../../system/chat.js";
import {
	ACTOR_TAG_TYPES,
	ACTOR_TYPES,
	EFFECT_TYPES,
	ITEM_TYPES,
	THEME_TAG_TYPES,
} from "../../system/config.js";
import { LitmSettings } from "../../system/settings.js";
import { findFellowshipTheme } from "../../utils.js";
import { advanceFlagLimit } from "../mixins/actor-limits.js";
import { EffectTagsMixin } from "../mixins/effect-tags-mixin.js";
import { LimitsMixin } from "../mixins/limits-mixin.js";

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
	if (actor.effects.some((e) => e.type === EFFECT_TYPES.relationship_tag))
		return;

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
 * Fires `litm.trackCompleted` when the mark fills the track.
 * @param {Actor} actor - The hero actor
 * @param {object} tag - Tag object with uuid and type properties
 * @returns {Promise<object|null>} The fired trackInfo, or null
 */
export async function gainImprovement(actor, tag) {
	// Relationship tags always improve the fellowship theme
	if (tag.type === EFFECT_TYPES.relationship_tag) {
		const fellowship = actor.system.fellowshipActor;
		if (!fellowship) return null;
		const theme = findFellowshipTheme(fellowship);
		if (!theme) return null;
		return completeTrackUpdate(
			theme,
			"system.improve.value",
			theme.system.improve.value + 1,
			fellowship,
			actor,
		);
	}

	// Trace effect → parent theme → owner actor via UUID
	if (!tag.uuid) return null;
	const effect = await foundry.utils.fromUuid(tag.uuid);
	if (!effect) return null;
	const parentTheme = effect.parent;
	if (!parentTheme || parentTheme.type !== ITEM_TYPES.theme) return null;
	const owner = parentTheme.parent;
	if (!owner) return null;
	return completeTrackUpdate(
		parentTheme,
		"system.improve.value",
		parentTheme.system.improve.value + 1,
		owner,
		actor,
	);
}

export class HeroData extends LimitsMixin(
	EffectTagsMixin(foundry.abstract.TypeDataModel),
) {
	/**
	 * Extra effect types partitioned by {@link EffectTagsMixin} in a single
	 * pass. Heroes are the only actor type that owns relationship_tag effects;
	 * exposing them via `this.relationships` (below) keeps the surface uniform.
	 */
	static extraEffectTypes = ["relationship_tag"];

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
			// Promise that overflowed past a Moment of Fulfillment trigger and
			// hasn't been applied yet. Per Core Book p.193: "Reset the track
			// to zero, and mark any remaining promise as usual." The wizard
			// banks the overflow here; the next Mof entry on the sheet resets
			// the track and re-applies pending (potentially cascading another
			// MoF if pending fills a fresh track).
			pendingPromise: new fields.NumberField({
				initial: 0,
				min: 0,
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
			// Singular `limit` — the hero's status-threshold readout for play mode
			// (max from CONFIG.litmv2.heroLimit; value = max minus highest active
			// status tier; see `prepareDerivedData`). Distinct from the plural
			// `limits` getter on {@link LimitsMixin}, which exposes the
			// flag-backed list of named limits used by the story-tag sidebar.
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

	/**
	 * Returns the linked fellowship actor for this hero, or the world singleton.
	 *
	 * NOTE: This getter deliberately reads `game.actors` — a global registry that is
	 * not available during early Foundry boot. This is the single intentional point
	 * where HeroData crosses the document→registry boundary. The guard below makes
	 * the getter safe to call before `game.actors` is populated (returns null).
	 */
	get fellowshipActor() {
		if (!game?.actors) return null;
		if (!LitmSettings.useFellowship) return null;
		if (this.fellowshipId) {
			const actor = game.actors.get(this.fellowshipId);
			if (actor) return actor;
		}
		return game.litmv2?.fellowship ?? null;
	}

	/**
	 * Own non-fellowship theme items, each with their tag AEs.
	 * @returns {{ theme: Item, tags: ActiveEffect[] }[]}
	 */
	get themes() {
		return this.#themeContainers(
			(i) => i.type === "theme" && !i.system.isFellowship,
		);
	}

	/**
	 * Own story_theme items, each with their tag AEs.
	 * @returns {{ theme: Item, tags: ActiveEffect[] }[]}
	 */
	get storyThemes() {
		return this.#themeContainers((i) => i.type === "story_theme");
	}

	#themeContainers(predicate) {
		return this.parent.items
			.filter(predicate)
			.sort((a, b) => a.sort - b.sort)
			.map((theme) => ({
				theme,
				tags: dedupeTitleTags(
					[...theme.effects].filter((e) => THEME_TAG_TYPES.has(e.type)),
				).sort(
					(a, b) =>
						(b.system.isTitleTag ? 1 : 0) - (a.system.isTitleTag ? 1 : 0),
				),
			}));
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
				if (!themeMap.has(item.id))
					themeMap.set(item.id, { theme: item, tags: [] });
				themeMap.get(item.id).tags.push(e);
			} else if (ACTOR_TAG_TYPES.has(e.type)) {
				tags.push(e);
			}
		}
		const themes = [...themeMap.values()].map(({ theme, tags: t }) => ({
			theme,
			tags: dedupeTitleTags(t).sort(
				(a, b) => (b.system.isTitleTag ? 1 : 0) - (a.system.isTitleTag ? 1 : 0),
			),
		}));
		return { themes, tags };
	}

	/**
	 * Relationship tag AEs on the hero, partitioned by {@link EffectTagsMixin}
	 * in `prepareDerivedData` (via `static extraEffectTypes`).
	 * @returns {ActiveEffect[]}
	 */
	get relationships() {
		return this._effectBuckets.relationship_tag ?? [];
	}

	/**
	 * All tags applicable to a roll for this hero, including fellowship tags when enabled.
	 * Returns raw ActiveEffect instances; callers are responsible for mapping to plain objects.
	 * @returns {ActiveEffect[]}
	 */
	get allRollTags() {
		const tags = [
			...this.themes.flatMap((g) => g.tags),
			...this.storyThemes.flatMap((g) => g.tags),
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
		const isScratchedPlayTag = (e) =>
			e.system?.isScratched &&
			e.type !== EFFECT_TYPES.weakness_tag &&
			e.type !== EFFECT_TYPES.status_tag;
		const scratched = [...this.parent.allApplicableEffects()].filter(
			isScratchedPlayTag,
		);
		const fellowship = this.fellowshipActor;
		if (fellowship) {
			scratched.push(
				...[...fellowship.allApplicableEffects()].filter(isScratchedPlayTag),
			);
		}
		return scratched;
	}

	prepareDerivedData() {
		super.prepareDerivedData();
		const baseLimit = CONFIG.litmv2?.heroLimit ?? 5;
		const highestStatus = this.statusEffects
			.filter((e) => e.active)
			.reduce((max, e) => Math.max(max, e.system.currentTier), 0);
		this.limit.value = baseLimit - highestStatus;
		this.limit.max = baseLimit;
	}

	/**
	 * Add a story_tag to this hero, routing through the backpack item.
	 * @override
	 * @param {object} effectData  Story tag effect creation data
	 * @returns {Promise<ActiveEffect[]|void>}
	 */
	async addStoryTag(effectData) {
		const backpack = this.backpackItem;
		if (!backpack) {
			ui.notifications.warn(game.i18n.localize("LITM.Ui.warn_no_backpack"));
			return;
		}
		return backpack.createEmbeddedDocuments("ActiveEffect", [
			{ ...effectData, transfer: true },
		]);
	}

	/**
	 * Record a Moment of Fulfillment: append an empty MoF entry and, per Core
	 * Book p.193, when the Promise track is full reset it to 0 and apply any
	 * banked `pendingPromise` (clamped to 5). Fires `litm.trackCompleted` when
	 * the applied pending fills another track, cascading the next MoF chat
	 * card. (When promise < 5 this is just a free narrative record — no math
	 * runs.)
	 * @returns {Promise<object|null>} The cascaded trackInfo, or null
	 */
	async recordMomentOfFulfillment() {
		const moments = foundry.utils.deepClone(this.mof ?? []);
		moments.push({ name: "", description: "" });

		const update = { "system.mof": moments };
		const currentPromise = this.promise ?? 0;
		const pending = this.pendingPromise ?? 0;
		if (currentPromise >= 5) {
			const applied = Math.min(pending, 5);
			update["system.promise"] = applied;
			update["system.pendingPromise"] = pending - applied;
		}

		await this.parent.update(update);

		if (update["system.promise"] !== 5) return null;
		return fireTrackCompletion("system.promise", 5, this.parent, this.parent);
	}

	/**
	 * Hero limits use the global heroLimit setting as their effective max
	 * rather than the per-limit stored max.
	 * @override
	 * @param {object} _limit
	 * @returns {number}
	 */
	getEffectiveMax(_limit) {
		return CONFIG.litmv2?.heroLimit ?? 5;
	}

	/**
	 * Advance (or set back) a flag-stored limit by `delta`.
	 * @param {string} limitId
	 * @param {number} delta
	 * @returns {Promise<import("../actor-limits.js").LimitChangeResult|null>}
	 */
	async advanceLimit(limitId, delta) {
		return advanceFlagLimit(this.parent, limitId, delta);
	}
}
