import { ACTOR_TYPES } from "../../system/config.js";
import { LitmSettings } from "../../system/settings.js";
import { findFellowshipTheme, getStoryTagSidebar } from "../../utils.js";
import { defaultCampingState, ensureHeroState } from "./camping-state.js";

const ONCE_PER_SCENE = new Set(["rest", "reflect"]);

/**
 * Resolve the list of hero actors that belong to "this camp." Heroes linked
 * to the fellowship singleton when one exists; otherwise every hero in the
 * world. Mirrors fellowship-sheet.js#buildPartyOverview.
 */
export function getCampingHeroes() {
	const fellowshipId = LitmSettings.fellowshipId;
	const allHeroes =
		game.actors?.filter((a) => a.type === ACTOR_TYPES.hero) ?? [];
	if (fellowshipId) {
		const linked = allHeroes.filter(
			(a) => a.system?.fellowshipId === fellowshipId,
		);
		if (linked.length) return linked;
	}
	return allHeroes;
}

/**
 * True when the current user can edit this hero's camping column. GMs can
 * always edit; otherwise the user must be a Foundry OWNER of the actor.
 */
export function canEditHero(actor) {
	if (!actor) return false;
	if (game.user.isGM) return true;
	return actor.testUserPermission?.(game.user, "OWNER") ?? false;
}

/**
 * Partition an actor's applicable effects into the buckets the camping UI
 * needs. Reading once and slicing beats four full traversals.
 */
function partitionEffects(actor) {
	const buckets = {
		statusEffects: [],
		// Rest recovery covers personal power tags only. Scratched
		// fellowship_tag effects are shared resources and are restored via
		// the once-per-camp quality-time choice, not via a single hero's Rest.
		scratchedRecoverable: [],
		relationshipEffects: [],
		scratchedFellowshipTags: [],
	};
	for (const e of actor.allApplicableEffects?.() ?? []) {
		if (e.type === "status_tag") buckets.statusEffects.push(e);
		else if (e.type === "relationship_tag") buckets.relationshipEffects.push(e);
		else if (e.type === "power_tag" && e.system?.isScratched) {
			buckets.scratchedRecoverable.push(e);
		} else if (e.type === "fellowship_tag" && e.system?.isScratched) {
			buckets.scratchedFellowshipTags.push(e);
		}
	}
	return buckets;
}

function buildBackpackPills(actor, heroState) {
	const backpackItem = actor.system?.backpackItem ?? null;
	if (!backpackItem) return [];
	const keptSet = new Set(heroState.backpackKept);
	return [...backpackItem.effects]
		.filter((e) => e.type === "story_tag")
		.map((e) => ({
			id: e.id,
			name: e.name,
			kept: keptSet.has(e.id),
		}));
}

/**
 * Build the list of themes a hero may Reflect on — their own + the
 * fellowship theme if linked.
 */
function buildReflectTargets(actor) {
	const ownThemes = (actor.system?.themes ?? []).map(({ theme }) => ({
		id: theme.id,
		name: theme.name,
		kind: "theme",
	}));
	const fellowshipActor = actor.system?.fellowshipActor ?? null;
	const fellowshipTheme = findFellowshipTheme(fellowshipActor);
	if (fellowshipTheme) {
		ownThemes.push({
			id: fellowshipTheme.id,
			name: `${fellowshipActor.name}: ${fellowshipTheme.name}`,
			kind: "fellowship",
		});
	}
	return ownThemes;
}

function buildActivityRows(
	heroState,
	periodCount,
	{ statusEffects, scratchedRecoverable, reflectTargets, isCamp },
) {
	const claimed = new Set(
		heroState.activities
			.map((a) => a.activity)
			.filter((a) => ONCE_PER_SCENE.has(a)),
	);
	return heroState.activities.slice(0, periodCount).map((act, ix) => {
		const restChoices = act.restChoices ?? {};
		const recoverSet = new Set(act.restRecoverTagIds ?? []);
		const reflectTargetName =
			reflectTargets.find((t) => t.id === act.reflectTargetItemId)?.name ?? "";
		const reflectAbandonName =
			reflectTargets.find((t) => t.id === act.reflectAbandonItemId)?.name ?? "";
		const reflectMilestoneName =
			reflectTargets.find((t) => t.id === act.reflectMilestoneItemId)?.name ??
			"";
		// Once-per-scene gating: the current activity is always allowed
		// (so the player can re-select it after clearing). Others are
		// allowed only if no other period in this hero's plan claims them.
		const canRest = act.activity === "rest" || !claimed.has("rest");
		const canReflect = act.activity === "reflect" || !claimed.has("reflect");
		return {
			index: ix,
			activity: act.activity ?? "",
			isRest: act.activity === "rest",
			isReflect: act.activity === "reflect",
			isCampAction: act.activity === "campAction",
			// Camp Reflect grants only Improve (Core Book p.181). Sojourn
			// Reflect additionally allows marking Milestone/Abandon. Surface
			// the flag so the template can hide those rows on a camp scene.
			showQuestMarks: !isCamp,
			canRest,
			canReflect,
			canCampAction: true,
			campActionDetail: act.campActionDetail ?? "",
			reflectTargetItemId: act.reflectTargetItemId ?? "",
			reflectTargetName,
			reflectAbandonItemId: act.reflectAbandonItemId ?? "",
			reflectAbandonName,
			reflectMilestoneItemId: act.reflectMilestoneItemId ?? "",
			reflectMilestoneName,
			restStatuses: statusEffects.map((e) => {
				const ch = restChoices[e.id] ?? { action: "", amount: 1 };
				const tier = e.system?.currentTier ?? 0;
				const decrement =
					ch.action === "remove"
						? tier
						: ch.action === "reduce"
							? Math.max(0, Math.min(ch.amount ?? 1, tier))
							: 0;
				return {
					id: e.id,
					name: e.name,
					currentTier: tier,
					restAction: ch.action,
					restAmount: ch.amount ?? 1,
					decrement,
					nextTier: Math.max(0, tier - decrement),
					willRemove: ch.action === "remove" || (tier > 0 && decrement >= tier),
					willKeep: decrement === 0,
					canDecrease: decrement < tier,
					canIncrease: decrement > 0,
				};
			}),
			restRecoverableTags: scratchedRecoverable.map((e) => ({
				id: e.id,
				name: e.name,
				checked: recoverSet.has(e.id),
			})),
			reflectTargets,
		};
	});
}

/**
 * Build the quality-time picker context. Fellowship Quality Time gives each
 * hero ONE exclusive action per camp: recover one scratched fellowship
 * theme tag, rephrase a scratched relationship tag, or create a new
 * relationship toward a fellowship hero they have none with. The selected
 * action (and its sub-selection) drives the apply pass at Pack Up.
 */
function buildQualityTimeContext(
	actor,
	heroState,
	allHeroes,
	relationshipEffects,
	scratchedFellowshipTags,
) {
	const quality = heroState.qualityTime ?? {};
	// Rephrase is offered for ANY existing relationship — the action covers
	// both renewing a spent (scratched) relationship and re-framing one
	// that hasn't been spent yet, so don't filter by isScratched here.
	const existingTargets = new Set(
		relationshipEffects.map((e) => e.system?.targetId).filter(Boolean),
	);
	const newRelationshipTargets = allHeroes
		.filter((other) => other.id !== actor.id && !existingTargets.has(other.id))
		.map((other) => ({ targetId: other.id, name: other.name, img: other.img }));

	const fellowshipTagOptions = scratchedFellowshipTags.map((e) => ({
		id: e.id,
		name: e.name,
	}));
	const relationshipOptions = relationshipEffects.map((e) => {
		const target = e.system?.targetId
			? game.actors?.get(e.system.targetId)
			: null;
		return {
			id: e.id,
			name: e.name,
			partnerName: target?.name ?? "",
		};
	});

	return {
		action: quality.action ?? "",
		canRecoverFellowship: fellowshipTagOptions.length > 0,
		canRephraseRelationship: relationshipOptions.length > 0,
		canCreateNewRelationship: newRelationshipTargets.length > 0,
		fellowshipTagOptions,
		fellowshipTagId: quality.fellowshipTagId ?? "",
		relationshipOptions,
		relationshipEffectId: quality.relationshipEffectId ?? "",
		relationshipRephrase: quality.relationshipRephrase ?? "",
		newRelationshipTargets,
		newRelationshipTargetId: quality.newRelationshipTargetId ?? "",
		newRelationshipName: quality.newRelationshipName ?? "",
		isRecoverFellowship: quality.action === "recoverFellowship",
		isRephraseRelationship: quality.action === "rephraseRelationship",
		isNewRelationship: quality.action === "newRelationship",
	};
}

function buildHeroContext(actor, heroState, allHeroes, isCamp) {
	const buckets = partitionEffects(actor);
	const backpackTags = buildBackpackPills(actor, heroState);
	const reflectTargets = buildReflectTargets(actor);
	const periodCount = heroState.thirdPeriodActive ? 3 : 2;
	const activities = buildActivityRows(heroState, periodCount, {
		...buckets,
		reflectTargets,
		isCamp,
	});
	const qualityTime = buildQualityTimeContext(
		actor,
		heroState,
		allHeroes,
		buckets.relationshipEffects,
		buckets.scratchedFellowshipTags,
	);
	return {
		id: actor.id,
		name: actor.name,
		img: actor.img,
		canEdit: canEditHero(actor),
		thirdPeriodActive: !!heroState.thirdPeriodActive,
		backpackTags,
		hasBackpack: backpackTags.length > 0,
		activities,
		qualityTime,
		hasQualityTimeOptions:
			qualityTime.canRecoverFellowship ||
			qualityTime.canRephraseRelationship ||
			qualityTime.canCreateNewRelationship,
	};
}

/**
 * Shape the live scene-flag state into the render context for the template.
 * Heroes are pre-shaped here; the template just iterates and emits markup.
 */
export function buildContext(state) {
	const live = state ?? defaultCampingState();
	const allHeroes = getCampingHeroes();
	const isCamp = live.type !== "sojourn";
	const showThreats = LitmSettings.showCampingThreats;
	const heroes = allHeroes.map((actor) =>
		buildHeroContext(actor, ensureHeroState(live, actor.id), allHeroes, isCamp),
	);
	const placeOfStay = buildPlaceOfStayContext(live);
	const threats = showThreats ? buildThreatsContext(live) : [];
	const sceneStoryTags = buildSceneStoryTags();
	return {
		heroes,
		hasHeroes: heroes.length > 0,
		placeOfStay,
		showThreats,
		threats,
		hasThreats: threats.length > 0,
		sceneStoryTags,
		hasSceneStoryTags: sceneStoryTags.length > 0,
	};
}

/**
 * Snapshot of every scene story tag currently on the scene, shaped for the
 * active-phase banner. We pull from the story-tag sidebar (single source of
 * truth) rather than from `createdCampsiteEffectIds` so the banner also
 * shows tags carried over from previous camps and any sidebar edits made
 * during this active session.
 */
export function buildSceneStoryTags() {
	const sidebar = getStoryTagSidebar();
	const sceneEffects = sidebar?.sceneStoryEffects ?? [];
	return sceneEffects.map((e) => ({
		id: e.id,
		name: e.name,
		type: e.type,
		isStatus: e.type === "status_tag",
		isSingleUse: !!e.system?.isSingleUse,
		currentTier: e.system?.currentTier ?? 0,
	}));
}

/**
 * GM-only "Place of Stay" block context. Lists scene story-tag pack effects
 * so the GM can flag any of them for expiry on pack-up, and exposes the
 * Place of Stay name + campsite-tags string for rendering.
 */
export function buildPlaceOfStayContext(state) {
	const placeOfStay = state.placeOfStay ?? {
		name: "",
		campsiteTags: "",
		threats: [],
		sceneTagsToExpire: [],
	};
	const sidebar = getStoryTagSidebar();
	const sceneTags = (sidebar?.sceneStoryEffects ?? []).map((e) => ({
		id: e.id,
		name: e.name,
		markedForExpiry: placeOfStay.sceneTagsToExpire.includes(e.id),
	}));
	return {
		placeOfStayName: placeOfStay.name ?? "",
		campsiteTags: placeOfStay.campsiteTags ?? "",
		sceneTags,
		hasSceneTags: sceneTags.length > 0,
	};
}

/**
 * Resolve the campsite Threats vignette ids into snapshot objects the
 * template (and the recap) can render directly. Missing/deleted items are
 * silently dropped so a stale id can't crash the render.
 */
export function buildThreatsContext(state) {
	const ids = state?.placeOfStay?.threats ?? [];
	return ids
		.map((id) => game.items?.get(id))
		.filter(Boolean)
		.map((item) => ({
			id: item.id,
			name: item.name,
			threat: item.system?.threat ?? "",
			consequences: [...(item.system?.consequences ?? [])],
			isConsequenceOnly: !!item.system?.isConsequenceOnly,
		}));
}
