import { isEffectVisible } from "../../active-effects/effect-queries.js";
import { error } from "../../logger.js";
import {
	ContentSources,
	WORLD_STORY_TAG_PACK_ID,
} from "../../system/content-sources.js";
import { LitmSettings } from "../../system/settings.js";
import {
	disambiguateNames,
	mapEffectForUI,
	normalizeConfig,
} from "./story-tag-helpers.js";

/**
 * Plain data store over the scene story-tag state: the world settings config
 * (tracked actors, limits, visibility) and the world story-tag compendium
 * pack. This is the read model the {@link StoryTagSidebar} renders from, and
 * what other apps (roll dialog, camping, apply-action menu) consult — none of
 * them need a rendered Application to read scene-tag state.
 *
 * Writes stay on the sidebar: pack mutations flow through its GM/player
 * socket fork and broadcast renders; the store only reads and caches.
 */
class StoryTagsStoreImpl {
	#cachedActors = null;
	#cachedResolved = null;

	/**
	 * The story tags configuration, validated and normalized.
	 * - Returns default empty config if settings are empty
	 * - Normalizes legacy bare actor IDs to full Actor UUIDs
	 * - Persists normalized config to settings if user is GM
	 * @returns {{actors: string[], limits: object[], hiddenActors?: string[]}}
	 */
	get config() {
		const raw = LitmSettings.storyTags;
		if (!raw || foundry.utils.isEmpty(raw)) {
			return { actors: [], limits: [] };
		}

		const { config, changed } = normalizeConfig(raw);
		if (changed && game.user?.isGM && game.ready) {
			void LitmSettings.setStoryTags(config).catch(error);
		}
		return config;
	}

	invalidateCache() {
		this.#cachedActors = null;
		this.#cachedResolved = null;
	}

	/** Synchronous pack documents — populated once `loadStoryTags()` has run. */
	get packStoryTags() {
		return game.packs.get(WORLD_STORY_TAG_PACK_ID)?.contents ?? [];
	}

	/** Read-only accessor over the scene story-tag pack effects.
	 *  Used by the Camping app to list scene tags eligible for expiry. */
	get sceneStoryEffects() {
		return this.packStoryTags;
	}

	/**
	 * Ensure the story tag pack documents are loaded. Foundry caches pack
	 * documents on the CompendiumCollection itself; subsequent reads via
	 * `packStoryTags` are synchronous.
	 * @returns {Promise<ActiveEffect[]>}
	 */
	async loadStoryTags() {
		try {
			return await ContentSources.getStoryTags();
		} catch {
			return [];
		}
	}

	/** @returns {Set<string>} UUIDs of active users' assigned characters */
	get userCharacterUuids() {
		return new Set(
			game.users
				.filter((u) => u.active && u.character)
				.map((u) => u.character.uuid),
		);
	}

	/**
	 * Resolve the tracked + auto-included UUIDs to actor documents, mapping
	 * scene-token UUIDs to their actor. Synchronous (via fromUuidSync), so
	 * callers in sync contexts (the chat-button gate) can use it directly.
	 * Returns triples so the view-model getter (needs token/uuid) and
	 * consequence sourcing (needs only the actor) share one resolution path.
	 * Cached until {@link invalidateCache} so the per-chat-render button gate
	 * doesn't re-read `config` (and its GM normalize-persist) or re-resolve
	 * UUIDs on every message render.
	 * @returns {{uuid: string, actor: Actor, tokenDoc: object|null}[]}
	 */
	resolveTrackedActors() {
		if (this.#cachedResolved) return this.#cachedResolved;
		const storedUuids = this.config.actors ?? [];
		const userCharacterUuids = this.userCharacterUuids;
		const fellowshipUuid = game.litmv2?.fellowship?.uuid;
		const autoUuids = [...userCharacterUuids];
		if (fellowshipUuid) autoUuids.push(fellowshipUuid);
		const mergedUuids = [...new Set([...autoUuids, ...storedUuids])];
		this.#cachedResolved = mergedUuids
			.map((uuid) => {
				const doc = foundry.utils.fromUuidSync(uuid, { strict: false });
				if (!doc) return null;
				const isToken = doc.documentName === "Token";
				const actor = isToken ? doc.actor : doc;
				return actor ? { uuid, actor, tokenDoc: isToken ? doc : null } : null;
			})
			.filter(Boolean);
		return this.#cachedResolved;
	}

	/**
	 * View-model list of tracked actors with their visible tags/statuses.
	 * Cached until {@link invalidateCache}; the invalidation hooks registered
	 * by {@link registerInvalidationHooks} keep it fresh.
	 * @returns {object[]}
	 */
	get actors() {
		if (this.#cachedActors) return this.#cachedActors;
		const userCharacterUuids = this.userCharacterUuids;
		const fellowshipUuid = game.litmv2?.fellowship?.uuid;
		const result =
			this.resolveTrackedActors()
				.map(({ uuid, actor, tokenDoc }) => ({
					// Concealed challenges show their alias to non-GM viewers
					name: actor.system.maskedName ?? tokenDoc?.name ?? actor.name,
					type: actor.type,
					img:
						tokenDoc?.texture?.src ||
						actor.prototypeToken?.texture?.src ||
						actor.img,
					id: uuid,
					actorId: uuid.replaceAll(".", "__"),
					isOwner: actor.isOwner,
					isUserCharacter:
						userCharacterUuids.has(actor.uuid) || actor.uuid === fellowshipUuid,
					hidden: (this.config.hiddenActors ?? []).includes(uuid),
					tags: [
						...(actor.system.storyTags ?? []),
						...(actor.system.statusEffects ?? []),
					]
						.filter((e) => !e.disabled)
						.filter(isEffectVisible)
						.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
						.map(mapEffectForUI),
				}))
				.filter((actor) => game.user.isGM || !actor.hidden) || [];
		disambiguateNames(result);
		this.#cachedActors = result;
		return result;
	}

	/** View-model list of scene story tags/statuses visible to this user. */
	get tags() {
		const effects = this.packStoryTags;
		return effects
			.filter(isEffectVisible)
			.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
			.map(mapEffectForUI);
	}

	get storyLimits() {
		return this.config.limits ?? [];
	}

	/**
	 * Register the cache-busting hooks so the actor view-model stays fresh
	 * when actors, effects, or items change. Called once at system init.
	 */
	registerInvalidationHooks() {
		const invalidate = () => this.invalidateCache();
		for (const name of [
			"updateActor",
			"createActiveEffect",
			"updateActiveEffect",
			"deleteActiveEffect",
			"createItem",
			"updateItem",
			"deleteItem",
		]) {
			Hooks.on(name, invalidate);
		}
	}
}

export const StoryTagsStore = new StoryTagsStoreImpl();
