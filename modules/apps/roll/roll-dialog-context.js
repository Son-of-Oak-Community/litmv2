/**
 * Pure context builders used by `LitmRollDialog._prepareContext`. Lifted out
 * of the dialog so the view-model construction is testable independently of
 * the rendered application.
 */

import { effectToPlain } from "../../active-effects/effect-queries.js";
import { ACTOR_TAG_TYPES, EFFECT_GROUP_LABELS } from "../../system/config.js";
import { localize as t } from "../../utils.js";

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
	const isVisibleTag = (e) =>
		e.active && (game.user.isGM || !e.system?.isHidden);
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
	const STORY_ACTOR_TYPES = new Set(["challenge", "journey", "story_theme"]);
	const gmViewerTabs = [];
	const storyGroups = [];
	const sidebarActors = dialog.storyTagSidebar.actors ?? [];
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
