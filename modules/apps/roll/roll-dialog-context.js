/**
 * Pure context builders used by `LitmRollDialog._prepareContext`. Lifted out
 * of the dialog so the view-model construction is testable independently of
 * the rendered application.
 */

import {
	effectToPlain,
	isEffectVisible,
} from "../../active-effects/effect-queries.js";
import { ACTOR_TAG_TYPES, EFFECT_GROUP_LABELS } from "../../system/config.js";
import { localize as t } from "../../utils.js";
import { StoryTagsStore } from "../story-tags/story-tags-store.js";

/**
 * Stable sort: tag-type bucket first (per `EFFECT_TAG_ORDER`), then name
 * case-insensitive. Shared by every context builder that emits a grouped
 * tag list.
 */
export const sortByTypeThenName = (tags, typeOrder) =>
	[...tags].sort((a, b) => {
		const typeA = typeOrder[a.type] ?? 99;
		const typeB = typeOrder[b.type] ?? 99;
		if (typeA !== typeB) return typeA - typeB;
		return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
	});

/**
 * Build the row decorator every tag list shares: selection state, lock
 * rules, the super-checkbox state cycle, and action-suggestion highlights.
 *
 * @param {object} opts
 * @param {boolean} opts.isOwner   Whether the viewer owns the rolling actor
 * @param {Set<string>} [opts.positiveSuggestedIds]  Tag ids the linked action suggests as helpful
 * @param {Set<string>} [opts.negativeSuggestedIds]  Tag ids the linked action suggests as hindering
 * @returns {(tag: object) => object}
 */
export function makeTagDecorator({
	isOwner,
	positiveSuggestedIds = new Set(),
	negativeSuggestedIds = new Set(),
}) {
	const currentUserId = game.user.id;
	const isGM = game.user.isGM;
	return (tag) => {
		const contributorId = tag.contributorId || null;
		const isOpposition =
			tag.actorType === "challenge" || tag.actorType === "journey";
		// Already-scratched (unavailable) tags cannot be invoked or re-burned;
		// lock the row so the super-checkbox has no valid transitions.
		const isUnavailable = tag.system?.isScratched === true;
		// Narrator-only inversion (Core Book p.76): power/weakness tags
		// expose a wider cycle for the GM. Players see the natural-polarity
		// cycle only — `playerAllowedStates` falls back to `allowedStates`
		// for tag types that aren't restricted.
		const baseStates =
			!isGM && tag.system?.playerAllowedStates
				? tag.system.playerAllowedStates
				: (tag.system?.allowedStates ?? tag.states ?? ",positive,negative");
		const states = isUnavailable
			? ""
			: isOpposition
				? ",negative,positive"
				: baseStates;
		const tagId = tag.id ?? tag._id;
		return {
			...tag,
			_id: tag._id ?? tag.id,
			id: tagId,
			key: tag.uuid ?? tag.id ?? tag._id,
			contributorId,
			displayName: tag.displayName || tag.name,
			locked:
				isUnavailable ||
				(!isOwner && contributorId && contributorId !== currentUserId),
			isUnavailable,
			states,
			value:
				tag.type === "status_tag"
					? (tag.system?.currentTier ?? tag.value ?? 0)
					: undefined,
			isPositiveSuggestion: positiveSuggestedIds.has(tagId),
			isNegativeSuggestion: negativeSuggestedIds.has(tagId),
		};
	};
}

/**
 * Insert a decorated tag into a theme-group map keyed by
 * `themeId ?? '__' + type` — the grouping shape shared by the contributed
 * panel and the GM viewer tabs.
 */
function pushThemeGroup(themeMap, rawTag, themeImg, tag) {
	const key = rawTag.themeId ?? `__${rawTag.type}`;
	const label = rawTag.themeName ?? rawTag.type;
	if (!themeMap.has(key)) {
		themeMap.set(key, { themeName: label, themeImg, tags: [] });
	}
	themeMap.get(key).tags.push(tag);
}

/**
 * Build contributed tag groups from other characters' selections.
 * Owners see every helper's claimed tags grouped per contributor/theme;
 * non-owner players see their own character's tags so they can contribute.
 *
 * @param {LitmRollDialog} dialog
 * @param {object} shared  Shared context utilities from _prepareContext
 * @returns {object[]} contributedTagGroups array
 */
export function buildContributedTagGroups(
	dialog,
	{ decorateTag, tagTypeOrder, isOwner },
) {
	const contributedActorMap = new Map();
	const ensureActorEntry = (key, name, img) => {
		if (!contributedActorMap.has(key)) {
			contributedActorMap.set(key, {
				actorName: name,
				actorImg: img,
				themeMap: new Map(),
			});
		}
		return contributedActorMap.get(key).themeMap;
	};

	if (isOwner) {
		for (const [effectId, sel] of dialog.selections) {
			if (!sel.contributorActorId || !sel.state) continue;
			const actor = game.actors.get(sel.contributorActorId);
			if (!actor) continue;
			const allTags = (actor.system.allRollTags ?? []).map(effectToPlain);
			const rawTag = allTags.find((t) => t.uuid === effectId);
			if (!rawTag) continue;
			const tag = decorateTag({
				...rawTag,
				state: sel.state,
				contributorId: sel.contributorId,
			});
			const themeMap = ensureActorEntry(
				sel.contributorActorId,
				sel.contributorActorName ?? actor.name,
				sel.contributorActorImg ?? actor.img,
			);
			const themeImg = rawTag.themeId
				? (actor.items.get(rawTag.themeId)?.img ?? null)
				: null;
			pushThemeGroup(themeMap, rawTag, themeImg, tag);
		}
	}

	// Non-owners see their own character's tags for contribution
	if (!isOwner && !game.user.isGM) {
		const ownCharacter = game.user.character;
		if (ownCharacter && ownCharacter.id !== dialog.actorId) {
			const themeMap = ensureActorEntry(
				ownCharacter.id,
				ownCharacter.name,
				ownCharacter.prototypeToken?.texture?.src || ownCharacter.img,
			);
			for (const e of ownCharacter.appliedEffects) {
				const rawTag = effectToPlain(e);
				const sel = dialog.getSelection(rawTag.uuid);
				const tag = decorateTag({
					...rawTag,
					state: sel.state,
					contributorId: sel.contributorId,
				});
				pushThemeGroup(themeMap, rawTag, e.parent?.img ?? null, tag);
			}
		}
	}

	return [...contributedActorMap.values()].map((entry) => ({
		actorName: entry.actorName,
		actorImg: entry.actorImg,
		themeGroups: [...entry.themeMap.values()].map((g) => ({
			...g,
			tags: sortByTypeThenName(g.tags, tagTypeOrder),
		})),
	}));
}

/**
 * Build the compact display context for a linked Action document. Returns
 * `null` when the document isn't an Action item.
 *
 * The roll dialog only needs identity for the action header strip — the
 * description, examples, success entries, and consequences live in the
 * action sheet (one click away via the strip's view button) and the
 * post-roll chat panel. Tag suggestions decorate the existing tag picker
 * directly in `LitmRollDialog#buildTagGroups`, not via this context.
 *
 * @param {object} args
 * @param {Item|null|undefined} args.action  The linked action document.
 * @returns {object|null}
 */
export function buildActionContext({ action }) {
	if (!action || action.type !== "action") return null;
	const sys = action.system;
	return {
		uuid: action.uuid,
		name: action.name,
		img: action.img,
		isRote: sys.isRote,
		practitioners: sys.practitioners,
	};
}

/**
 * Build character and fellowship tag groups for the dialog owner — i.e. the
 * player whose actor is rolling. Theme tags, backpack story tags, hero
 * statuses, fellowship themes/tags, and relationship tags each become their
 * own group entry. Selection state on each tag is read via
 * `dialog.getSelection(uuid)`.
 *
 * @param {LitmRollDialog} dialog
 * @param {object} shared
 * @param {Function} shared.decorateTag
 * @returns {{ characterTagGroups: object[], fellowshipTagGroups: object[] }}
 */
export function buildOwnerContext(dialog, { decorateTag }) {
	const characterTagGroups = [];
	const fellowshipTagGroups = [];
	const sys = dialog.actor?.system;
	if (!sys) return { characterTagGroups, fellowshipTagGroups };

	const withSelection = (effect) => {
		const sel = dialog.getSelection(effect.uuid);
		return decorateTag({
			_id: effect._id,
			id: effect.id ?? effect._id,
			uuid: effect.uuid,
			name: effect.name,
			type: effect.type,
			system: effect.system,
			parent: effect.parent,
			state: sel.state,
			contributorId: sel.contributorId,
		});
	};

	// Hero themes and story-themes both expose theme-tag groups to the dialog.
	const themeContainers = [...(sys.themes ?? []), ...(sys.storyThemes ?? [])];
	for (const { theme, tags } of themeContainers) {
		const activeTags = tags.filter((e) => e.active).map(withSelection);
		if (activeTags.length) {
			characterTagGroups.push({
				themeName: theme.name,
				themeImg: theme.img,
				tags: activeTags,
			});
		}
	}

	// Backpack / story tags — use storyTags (allApplicableEffects) to catch
	// story_tag effects regardless of whether they live on the backpack item
	// or directly on the actor.
	const isVisibleTag = (e) => e.active && isEffectVisible(e);
	const backpackTags = (sys.storyTags ?? sys.backpack ?? [])
		.filter(isVisibleTag)
		.map(withSelection);
	if (backpackTags.length) {
		const backpackItem = dialog.actor.system.backpackItem;
		characterTagGroups.push({
			themeName: backpackItem?.name ?? t("LITM.Terms.backpack"),
			themeImg: backpackItem?.img ?? null,
			tags: backpackTags,
		});
	}

	// Hero statuses
	const heroStatuses = sys.statusEffects
		.filter(isVisibleTag)
		.map(withSelection);
	if (heroStatuses.length) {
		characterTagGroups.push({
			themeName: t("LITM.Terms.statuses"),
			icon: "fa-solid fa-droplet",
			tags: heroStatuses,
		});
	}

	// Fellowship
	const fellowship = sys.fellowship;
	for (const { theme, tags } of fellowship.themes) {
		const activeTags = tags.filter((e) => e.active).map(withSelection);
		if (activeTags.length) {
			fellowshipTagGroups.push({
				themeName: theme.name,
				themeImg: theme.img,
				tags: activeTags,
			});
		}
	}
	const fellowshipNonTheme = fellowship.tags.filter((e) => e.active);
	const fellowshipStoryTags = fellowshipNonTheme
		.filter((e) => e.type === "story_tag")
		.map(withSelection);
	if (fellowshipStoryTags.length) {
		fellowshipTagGroups.push({
			themeName: t("LITM.Terms.story_tags"),
			icon: "fa-solid fa-tags",
			tags: fellowshipStoryTags,
		});
	}
	const fellowshipStatuses = fellowshipNonTheme
		.filter((e) => e.type === "status_tag")
		.map(withSelection);
	if (fellowshipStatuses.length) {
		fellowshipTagGroups.push({
			themeName: t("LITM.Terms.statuses"),
			icon: "fa-solid fa-droplet",
			tags: fellowshipStatuses,
		});
	}

	// Relationship tags. Single bucket; the target hero is rendered as a
	// plain-text suffix outside the tag chip (see the `tag` partial in
	// roll-dialog.html) so the chip chrome stays clean.
	const relTags = sys.relationships.filter((e) => e.name);
	if (relTags.length) {
		const mapped = relTags.map((rel) => {
			const decorated = withSelection(rel);
			const targetId = rel.system?.targetId;
			const target = targetId ? game.actors?.get(targetId) : null;
			if (target) decorated.targetName = target.name;
			return decorated;
		});
		fellowshipTagGroups.push({
			themeName: t("LITM.Terms.relationship"),
			icon: "fa-solid fa-handshake",
			tags: mapped,
		});
	}

	return { characterTagGroups, fellowshipTagGroups };
}

/** Sidebar actor types whose tags belong to the Story/Scene surface. */
const STORY_ACTOR_TYPES = new Set(["challenge", "journey", "story_theme"]);
const HERO_ACTOR_TYPES = new Set(["hero"]);

/**
 * Build per-actor tag groups from the story-tag sidebar for the given actor
 * types. The shared core behind {@link buildAllyTagGroups} (fellowship
 * heroes → Allies tab) and {@link buildSceneActorTagGroups}
 * (challenges/journeys/story themes → Scene tab).
 *
 * Visibility piggybacks on the sidebar's own filtering: hidden actors and
 * hidden effects are already excluded for non-GM users by the sidebar's
 * `actors` getter (concealed challenges arrive pre-masked the same way).
 * Tags whose selection entry carries `contributorActorId` are skipped here —
 * those render in the contributed-tags section instead, attributed to the
 * helping player. Non-owner viewers only see selected tags, and never their
 * own character's (their contribution panel already lists those).
 *
 * `actorType` rides along on each tag so `decorateTag` can apply the
 * opposition cycle (negative-first, no burn) to challenge/journey tags.
 *
 * @param {LitmRollDialog} dialog
 * @param {object} shared
 * @param {Function} shared.decorateTag
 * @param {object}   shared.tagTypeOrder
 * @param {boolean}  shared.isOwner
 * @param {Set<string>} types  Sidebar actor types to include
 * @returns {object[]} array of { actorName, actorImg, tags }
 */
function buildSidebarActorTagGroups(
	dialog,
	{ decorateTag, tagTypeOrder, isOwner },
	types,
) {
	const groups = [];
	const sidebarActors = StoryTagsStore.actors ?? [];
	const ownCharacterUuid = !isOwner ? game.user.character?.uuid : null;
	for (const sidebarActor of sidebarActors) {
		if (!types.has(sidebarActor.type)) continue;
		if (sidebarActor.id === dialog.actor?.uuid) continue;
		if (ownCharacterUuid && sidebarActor.id === ownCharacterUuid) continue;
		const tags = (sidebarActor.tags ?? [])
			.map((tag) => {
				const sel = dialog.getSelection(tag.uuid);
				if (sel.contributorActorId) return null;
				if (!isOwner && !sel.state) return null;
				return decorateTag({
					...tag,
					actorType: sidebarActor.type,
					state: sel.state,
					contributorId: sel.contributorId,
				});
			})
			.filter(Boolean);
		if (!tags.length) continue;
		groups.push({
			actorName: sidebarActor.name,
			actorImg: sidebarActor.img,
			tags: sortByTypeThenName(tags, tagTypeOrder),
		});
	}
	return groups;
}

/**
 * Per-hero tag groups for the other fellowship heroes — the ally backpack
 * story tags and statuses visible in the story-tag sidebar. Lets the
 * rolling player invoke an ally's tag directly (e.g. burn a friend's
 * signal arrow, or lean on their status) without waiting for that player
 * to contribute it themselves.
 */
export function buildAllyTagGroups(dialog, shared) {
	return buildSidebarActorTagGroups(dialog, shared, HERO_ACTOR_TYPES);
}

/**
 * Per-actor tag groups for the scene opposition — sidebar-visible
 * challenges, journeys, and story themes — so players can pull a
 * challenge's tags/statuses into their roll from the Scene tab.
 */
export function buildSceneActorTagGroups(dialog, shared) {
	return buildSidebarActorTagGroups(dialog, shared, STORY_ACTOR_TYPES);
}

/**
 * Build per-actor tabs for GM viewers from the story tag sidebar actors.
 *
 * @param {LitmRollDialog} dialog  The roll dialog instance.
 * @param {object} shared          Shared context utilities from _prepareContext.
 * @param {Function} shared.decorateTag
 * @param {object}   shared.tagTypeOrder
 * @param {object[]} shared.allStoryItems
 * @param {object[]} shared.sceneStoryItems
 * @param {boolean}  shared.isOwner
 * @returns {object[]} gmViewerTabs array
 */
export function buildGmViewerContext(
	dialog,
	{ decorateTag, tagTypeOrder, allStoryItems, sceneStoryItems, isOwner },
) {
	const gmViewerTabs = [];
	const storyGroups = [];
	const sidebarActors = StoryTagsStore.actors ?? [];
	const sidebarActorIds = sidebarActors.map((a) => a.id);
	// Always include the rolling actor so the GM can see their tags
	const rollingUuid = dialog.actor.uuid;
	const storyTagActorIds = sidebarActorIds.includes(rollingUuid)
		? sidebarActorIds
		: [rollingUuid, ...sidebarActorIds];
	for (const actorId of storyTagActorIds) {
		const actor = foundry.utils.fromUuidSync(actorId);
		if (!actor) continue;
		const actorImg = actor.prototypeToken?.texture?.src || actor.img;
		const themeMap = new Map();
		// Use appliedEffects (active only) for GM viewer.
		// For actor-level effects (status_tag, story_tag, relationship_tag),
		// group by type rather than parent name to avoid a catch-all actor group.
		for (const e of actor.appliedEffects) {
			const sel = dialog.getSelection(e.uuid);
			const rawTag = effectToPlain(e);
			const tag = decorateTag({
				...rawTag,
				state: sel.state,
				contributorId: sel.contributorId,
			});
			// story_tag and status_tag effects always group by type so that
			// backpack-item tags and actor-level tags share one section.
			// Theme tags (power_tag, etc.) group by parent item.
			const groupByType = e.parent === actor || ACTOR_TAG_TYPES.has(e.type);
			let groupKey, groupLabel, groupImg;
			if (groupByType) {
				groupKey = `__${e.type}`;
				const labelKey = EFFECT_GROUP_LABELS[e.type];
				groupLabel = labelKey
					? t(labelKey)
					: e.type === "story_tag"
						? (actor.system.backpackItem?.name ?? t("LITM.Terms.backpack"))
						: e.type;
				groupImg =
					e.type === "story_tag"
						? (actor.system.backpackItem?.img ?? null)
						: null;
			} else {
				groupKey = rawTag.themeId ?? `__${rawTag.type}`;
				groupLabel = rawTag.themeName ?? rawTag.type;
				groupImg = e.parent?.img ?? null;
			}
			if (!themeMap.has(groupKey)) {
				themeMap.set(groupKey, {
					themeName: groupLabel,
					themeImg: groupImg,
					tags: [],
				});
			}
			themeMap.get(groupKey).tags.push(tag);
		}
		// Add actor story items to this tab
		const actorStory = allStoryItems
			.filter((tag) => tag.actorName === actor.name)
			.filter((tag) => isOwner || game.user.isGM || !!tag.state);
		if (actorStory.length) {
			themeMap.set("__actor_story", {
				themeName: t("LITM.Tags.story"),
				tags: sortByTypeThenName(actorStory, tagTypeOrder),
			});
		}
		const groups = [...themeMap.values()].map((g) => ({
			...g,
			tags: sortByTypeThenName(g.tags, tagTypeOrder),
		}));
		if (!groups.length) continue;
		if (STORY_ACTOR_TYPES.has(actor.type) && actor.id !== dialog.actorId) {
			for (const group of groups) {
				storyGroups.push({
					...group,
					themeName: group.themeName
						? `${actor.name} — ${group.themeName}`
						: actor.name,
					themeImg: group.themeImg ?? actorImg,
				});
			}
		} else {
			gmViewerTabs.push({
				id: actor.id,
				label: actor.name,
				actorImg,
				groups,
			});
		}
	}
	// Merged Story tab: scene-level story tags + challenge/journey/story_theme actors
	const mergedStoryTab =
		sceneStoryItems.length || storyGroups.length
			? {
					id: "__story",
					label: t("LITM.Tags.story"),
					icon: "fa-solid fa-tags",
					groups: [
						...(sceneStoryItems.length
							? [{ themeName: null, tags: sceneStoryItems }]
							: []),
						...storyGroups,
					],
				}
			: null;
	// Sort: rolling actor first, then Story, then Fellowship, then other heroes
	const fellowshipId = game.litmv2?.fellowship?.id;
	const rollingActorTab = gmViewerTabs.find((t) => t.id === dialog.actorId);
	const fellowshipTab = fellowshipId
		? gmViewerTabs.find((t) => t.id === fellowshipId)
		: null;
	const otherTabs = gmViewerTabs.filter(
		(t) => t.id !== dialog.actorId && t.id !== fellowshipId,
	);
	gmViewerTabs.length = 0;
	if (rollingActorTab) gmViewerTabs.push(rollingActorTab);
	if (mergedStoryTab) gmViewerTabs.push(mergedStoryTab);
	if (fellowshipTab) gmViewerTabs.push(fellowshipTab);
	gmViewerTabs.push(...otherTabs);
	// Initialize native tab group tracking
	const initialTab = gmViewerTabs[0]?.id;
	dialog.tabGroups["gm-viewer"] ??= initialTab;
	for (const tab of gmViewerTabs) {
		tab.cssClass = dialog.tabGroups["gm-viewer"] === tab.id ? "active" : "";
	}
	return gmViewerTabs;
}
