import { ACTOR_TYPES } from "../../system/config.js";
import { LitmSettings } from "../../system/settings.js";
import {
	findFellowshipTheme,
	getStoryTagSidebar,
	localize as t,
} from "../../utils.js";
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
	// Both active and disabled tags are selectable. For active tags, "kept"
	// means "don't deactivate me at Pack Up"; for disabled tags it means
	// "re-enable me at Pack Up". The apply pass mirrors this — see the
	// disables/enables ops in buildBackpackOps. Default state per type:
	// active = kept (won't be scratched), disabled = not-kept (won't be
	// re-enabled). The user only toggles when they want the opposite.
	return [...backpackItem.effects]
		.filter((e) => e.type === "story_tag")
		.map((e) => ({
			id: e.id,
			name: e.name,
			disabled: !!e.disabled,
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
	const sceneStoryTags = buildSceneStoryTags(live.campId);
	const activeStep = live.activeStep ?? "period1";
	const steps = buildSteps(activeStep, heroes);
	return {
		heroes,
		hasHeroes: heroes.length > 0,
		placeOfStay,
		showThreats,
		threats,
		hasThreats: threats.length > 0,
		sceneStoryTags,
		hasSceneStoryTags: sceneStoryTags.length > 0,
		activeStep,
		steps,
		stepIsPeriod1: activeStep === "period1",
		stepIsPeriod2: activeStep === "period2",
		stepIsPeriod3: activeStep === "period3",
		stepIsQualityTime: activeStep === "qualityTime",
		stepIsPackUp: activeStep === "packUp",
	};
}

/**
 * Build the wizard timeline for the active phase. Period 3 is only emitted
 * when at least one hero has opted in via thirdPeriodActive — the toggle
 * lives in the Period 2 step row, so opting in *during* Period 2 grows the
 * timeline reactively. Each step carries:
 *   - isCurrent:  the activeStep id matches
 *   - isComplete: per-step heuristic (see stepIsComplete)
 *   - cssClass:   handy class list the template can drop in directly
 */
export function buildSteps(activeStep, heroes) {
	const anyThirdPeriod = heroes.some((h) => h.thirdPeriodActive);
	// Mirror stepOrder() in camping-state.js: keep Period 3 visible when it
	// is the current step even if no hero is opted in any longer.
	const showThirdPeriod = anyThirdPeriod || activeStep === "period3";
	const ids = ["period1", "period2"];
	if (showThirdPeriod) ids.push("period3");
	ids.push("qualityTime", "packUp");
	return ids.map((id) => {
		const isCurrent = id === activeStep;
		const isComplete = stepIsComplete(id, heroes);
		return {
			id,
			label: stepLabel(id),
			isCurrent,
			isComplete,
			cssClass: [
				isCurrent ? "active" : "",
				isComplete && !isCurrent ? "complete" : "",
			]
				.filter(Boolean)
				.join(" "),
		};
	});
}

function stepLabel(id) {
	switch (id) {
		case "period1":
			return t("LITM.Ui.camping_step_period_one");
		case "period2":
			return t("LITM.Ui.camping_step_period_two");
		case "period3":
			return t("LITM.Ui.camping_step_period_three");
		case "qualityTime":
			return t("LITM.Ui.camping_step_quality_time");
		case "packUp":
			return t("LITM.Ui.camping_step_pack_up");
		default:
			return id;
	}
}

/**
 * Completion heuristic per step. Drives the timeline's "✓" marker only;
 * it does NOT gate navigation (free-nav lets the GM jump anywhere).
 *
 *   period1/period2: every hero has an activity set for that slot
 *   period3:         every opted-in hero has an activity set; if no hero
 *                    opted in the step isn't in the timeline anyway
 *   qualityTime:     every hero has an explicit action picked
 *   packUp:          terminal — never marked complete (the Pack Up button
 *                    is the actual commit)
 */
export function stepIsComplete(stepId, heroes) {
	if (!heroes.length) return false;
	if (stepId === "period1") {
		return heroes.every((h) => !!h.activities[0]?.activity);
	}
	if (stepId === "period2") {
		return heroes.every((h) => !!h.activities[1]?.activity);
	}
	if (stepId === "period3") {
		const optedIn = heroes.filter((h) => h.thirdPeriodActive);
		if (!optedIn.length) return false;
		return optedIn.every((h) => !!h.activities[2]?.activity);
	}
	if (stepId === "qualityTime") {
		return heroes.every((h) => !!h.qualityTime?.action);
	}
	return false;
}

/**
 * Snapshot of scene story tags created during the active camp session,
 * shaped for the active-phase banner. Pre-existing scene tags (carried
 * over from previous camps, or any unrelated effects sitting in the
 * sidebar) are deliberately excluded — the banner is meant to "paint
 * the scene" of THIS camp, not summarise the table's entire story-tag
 * inventory.
 *
 * The campId stamp is applied to every effect created during Begin Camp
 * and during ops dispatched via the active-phase UI; tags created in
 * the sidebar without going through camping (e.g. a GM dragging in a
 * leftover story tag) won't be stamped and won't appear here.
 */
export function buildSceneStoryTags(campId) {
	if (!campId) return [];
	const sidebar = getStoryTagSidebar();
	const sceneEffects = sidebar?.sceneStoryEffects ?? [];
	return sceneEffects
		.filter((e) => e.getFlag?.("litmv2", "campId") === campId)
		.map((e) => ({
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
