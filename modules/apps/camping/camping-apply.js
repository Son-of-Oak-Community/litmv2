import { relationshipTagEffect } from "../../active-effects/effect-factories.js";
import { StatusTagData } from "../../active-effects/status-tag-data.js";
import { parseTagString } from "../../item/action/tag-string.js";
import { detectTrackCompletion } from "../../system/chat.js";
import { Sockets } from "../../system/sockets.js";
import { findFellowshipTheme, getStoryTagSidebar } from "../../utils.js";
import { ensureHeroState } from "./camping-state.js";

// Max value of a theme's Milestone / Abandon quest tracks. The final
// mark fires `detectTrackCompletion` and reveals the track-complete chat
// card; further marks during the same pack-up are dropped (the standing
// card must be resolved first). The Improve track uses the configurable
// `CONFIG.litmv2.improveThreshold` instead — see `trackMax()`.
const TRACK_MAX = 3;

/** Effective max for a theme track — Improve is world-configurable. */
function trackMax(track) {
	return track === "improve" ? CONFIG.litmv2.improveThreshold : TRACK_MAX;
}

/**
 * Build the operation plan and recap from final camping state and a small
 * `world` shim. World gives us hero lookups, scene effects, and the fellowship
 * actor — abstracted so we can test without booting Foundry.
 *
 * Campsite tag creation does NOT happen here — it lives at Begin Camp so
 * the tags are real scene effects throughout the active phase and can be
 * invoked in camp actions for Power. Pack Up just leaves them in place.
 *
 * Returns:
 *   operations: {
 *     statusReductions:      [{ effect, amount }],
 *     statusDeletes:         [{ effect }],
 *     unscratches:           [{ effect }],
 *     renames:               [{ effect, newName }],
 *     improves:              [{ theme, owner, newValue }],  // camp-mode reflect
 *     improvements:          [{ theme, owner, sourceHero }], // sojourn-mode reflect
 *     questMarks:            [{ theme, owner, track, newValue, sourceHero }],
 *     relationshipCreations: [{ heroActor, targetId, name }],
 *   }
 *   recap: mirrors the camp scene's own flow — Periods, then Quality Time,
 *   then Pack Up — so the chat card reads in the order the camp played out.
 *   Each stage holds per-hero entries: `{ id, name, img, activity, lines }`
 *   for periods/quality time, `{ id, name, img, kept }` for pack up (the
 *   backpack tags carried into the next adventure). Empty stages are dropped.
 */
export function buildOperations(state, world) {
	const ops = emptyOps();
	const recap = {
		type: state.type,
		sojournDuration: state.sojournDuration,
		placeOfStay: {
			name: state.placeOfStay?.name ?? "",
			// Each entry: { name, isStatus, tier, isSingleUse } — typed so the
			// recap can render proper tag/status chips.
			campsiteTags: [],
			// Each entry: { id, name, threat, consequences[], isConsequenceOnly }
			threats: [],
		},
		stages: [],
	};

	buildPlaceOfStayOps(state, world, recap);

	// Accumulators for camp-mode fellowship-theme marks: two heroes
	// reflecting on the same fellowship theme both read the same baseline
	// track value, so we stack increments and emit a single update per
	// (owner, theme, track). Sojourn improvements are independent and skip
	// the accumulator (each hero gains a separate improvement).
	const trackAccum = {
		improve: new Map(),
		abandon: new Map(),
		milestone: new Map(),
	};

	// Stage skeletons in camp-flow order. Periods use a generic "Period" label
	// — the circled `number` carries the count, so a numbered label would read
	// "① Period 1". Quality Time / Pack Up keep their full timeline labels.
	const stages = {
		period1: stageSkeleton("period1", "LITM.Ui.camping_recap_period", 1),
		period2: stageSkeleton("period2", "LITM.Ui.camping_recap_period", 2),
		period3: stageSkeleton("period3", "LITM.Ui.camping_recap_period", 3),
		qualityTime: stageSkeleton(
			"qualityTime",
			"LITM.Ui.camping_step_quality_time",
		),
		packUp: stageSkeleton("packUp", "LITM.Ui.camping_step_pack_up"),
	};

	for (const hero of world.heroes ?? []) {
		const heroState = ensureHeroState(state, hero.id);
		buildActivityOps(hero, heroState, state, world, trackAccum, ops, stages);
		buildQualityTimeOps(hero, heroState, world, ops, stages.qualityTime);
		buildBackpackOps(hero, heroState, ops, stages.packUp);
	}

	recap.stages = Object.values(stages).filter((s) => s.heroes.length);
	return { operations: ops, recap };
}

function stageSkeleton(key, labelKey, number = null) {
	return { key, labelKey, number, heroes: [] };
}

/** Identity slice of a hero for a recap stage entry. */
function heroRef(hero) {
	return { id: hero.id, name: hero.name, img: hero.img ?? null };
}

function emptyOps() {
	return {
		statusReductions: [],
		statusDeletes: [],
		unscratches: [],
		// Backpack tags the hero didn't keep are *deactivated* (Foundry's
		// disabled flag), not scratched — the effect stays on the bag and
		// can be re-enabled later instead of consumed.
		disables: [],
		// Symmetric to disables: previously-deactivated backpack tags the
		// hero ticked to bring back. Clears the disabled flag at Pack Up.
		enables: [],
		renames: [],
		improves: [],
		improvements: [],
		// Abandon / Milestone Quest marks from Reflect (Core Book p.181).
		// Each entry: { theme, owner, track: "abandon" | "milestone", newValue, sourceHero }
		questMarks: [],
		relationshipCreations: [],
	};
}

function collectEffects(actor) {
	if (typeof actor?.allApplicableEffects === "function") {
		return [...actor.allApplicableEffects()];
	}
	return [];
}

/**
 * Parse the campsite-tags string with the canonical `parseTagString`.
 * Core Book p.179 lists positive tags, negative tags, AND statuses as
 * legitimate place-of-stay attachments — `[name-tier]` covers statuses,
 * `[name]` covers tags, `[name!]` covers single-use tags.
 *
 * Exported so the camping-scene module can call it at Begin Camp time to
 * materialize the campsite into real scene effects (so heroes can invoke
 * them in their camp action rolls).
 */
export function parseCampsiteEntries(raw) {
	return parseTagString(typeof raw === "string" ? raw.trim() : "");
}

function describeCampsiteEntry(entry) {
	const isStatus = entry.type === "status_tag";
	return {
		name: entry.name,
		isStatus,
		tier: isStatus ? StatusTagData.tierOf(entry.system?.tiers) : 0,
		isSingleUse: !isStatus && !!entry.system?.isSingleUse,
	};
}

function buildPlaceOfStayOps(state, world, recap) {
	// Scene-tag expiry happens at Begin Camp now, alongside campsite
	// creation — by Pack Up time the expired effects are already gone, so
	// nothing to queue here. Campsite creation likewise happens at Begin
	// Camp; here we just echo the resolved entries in the recap.
	for (const entry of parseCampsiteEntries(state.placeOfStay?.campsiteTags)) {
		recap.placeOfStay.campsiteTags.push(describeCampsiteEntry(entry));
	}
	// Threats are resolved into snapshot data by the caller (the apply
	// layer is Foundry-free, so item lookups happen in camping-scene.js).
	// We just copy what came in; recap consumers decide how to display.
	for (const entry of world.threatItems ?? []) {
		recap.placeOfStay.threats.push({
			id: entry.id ?? null,
			name: entry.name ?? "",
			threat: entry.threat ?? "",
			consequences: Array.isArray(entry.consequences)
				? [...entry.consequences]
				: [],
			isConsequenceOnly: !!entry.isConsequenceOnly,
		});
	}
}

function buildBackpackOps(hero, heroState, ops, packStage) {
	const backpack = hero.system?.backpackItem ?? null;
	if (!backpack) return;
	const keptSet = new Set(heroState.backpackKept);
	// The recap lists what the hero packed — the tags active after Pack Up.
	// Everything else is history; no "deactivated/re-enabled" bookkeeping
	// prose (issue #104).
	const kept = [];
	for (const effect of backpack.effects) {
		if (effect.type !== "story_tag") continue;
		const isKept = keptSet.has(effect.id);
		// Active + not kept → disable. Disabled + kept → re-enable. The
		// other two combinations leave the effect alone.
		if (!effect.disabled && !isKept) {
			ops.disables.push({ effect });
		} else if (effect.disabled && isKept) {
			ops.enables.push({ effect });
		}
		if (isKept) {
			kept.push({
				name: effect.name,
				isSingleUse: !!effect.system?.isSingleUse,
			});
		}
	}
	packStage.heroes.push({ ...heroRef(hero), kept });
}

function buildActivityOps(
	hero,
	heroState,
	state,
	world,
	trackAccum,
	ops,
	stages,
) {
	const periodCount = heroState.thirdPeriodActive ? 3 : 2;
	const allFx = collectEffects(hero);
	for (let p = 0; p < periodCount; p++) {
		const act = heroState.activities[p];
		if (!act?.activity) continue;
		const entry = { ...heroRef(hero), activity: act.activity, lines: [] };
		if (act.activity === "rest") buildRestOps(act, allFx, ops, entry.lines);
		else if (act.activity === "reflect")
			buildReflectOps(act, hero, state, world, trackAccum, ops, entry.lines);
		else if (act.activity === "campAction") {
			entry.lines.push({
				kind: "campAction",
				detail: act.campActionDetail ?? "",
			});
		}
		stages[`period${p + 1}`].heroes.push(entry);
	}
}

function buildRestOps(act, allFx, ops, lines) {
	for (const [statusId, choice] of Object.entries(act.restChoices ?? {})) {
		const effect = allFx.find((e) => e.id === statusId);
		if (!effect) continue;
		if (choice.action === "remove") {
			ops.statusDeletes.push({ effect });
			lines.push({
				kind: "status-cleared",
				name: effect.name,
				tier: effect.system?.currentTier ?? 0,
			});
		} else if (choice.action === "reduce") {
			const cap = effect.system?.currentTier ?? 0;
			const amount = Math.max(1, Math.min(choice.amount ?? 1, cap || 6));
			ops.statusReductions.push({ effect, amount });
			// A reduction down to 0 deletes the status at apply time — recap
			// it as cleared rather than "becomes name-0".
			const to = cap - amount;
			if (cap > 0 && to > 0) {
				lines.push({
					kind: "status-reduced",
					name: effect.name,
					from: cap,
					to,
				});
			} else {
				lines.push({ kind: "status-cleared", name: effect.name, tier: cap });
			}
		}
	}
	for (const recoverId of act.restRecoverTagIds ?? []) {
		const effect = allFx.find((e) => e.id === recoverId);
		// Rest recovers personal power tags only. Fellowship tags are
		// shared and refresh exclusively via the Quality Time choice — drop
		// any stale id of the wrong type defensively, so a buggy UI or a
		// stale client can't unilaterally restore a shared resource.
		if (effect && effect.type === "power_tag") {
			ops.unscratches.push({ effect });
			lines.push({ kind: "tag-recovered", name: effect.name });
		}
	}
}

/**
 * Resolve a theme id chosen during Reflect (own theme or the linked
 * fellowship theme) to the theme + owning actor + whether it's the
 * fellowship theme. Returns nulls if the id matches nothing this hero
 * can act on.
 */
function resolveReflectTheme(themeId, hero, world) {
	if (!themeId) return { theme: null, owner: null, isFellowshipTarget: false };
	const ownThemes = hero.system?.themes ?? [];
	const ownMatch = ownThemes.find(({ theme }) => theme.id === themeId);
	if (ownMatch) {
		return { theme: ownMatch.theme, owner: hero, isFellowshipTarget: false };
	}
	const fellowshipActor =
		hero.system?.fellowshipActor ?? world.fellowshipActor ?? null;
	const fellowshipTheme = findFellowshipTheme(fellowshipActor);
	if (fellowshipTheme && fellowshipTheme.id === themeId) {
		return {
			theme: fellowshipTheme,
			owner: fellowshipActor,
			isFellowshipTarget: true,
		};
	}
	return { theme: null, owner: null, isFellowshipTarget: false };
}

/**
 * Accumulator-aware track bump. For a fellowship theme, multiple heroes
 * marking the same track stack into a single update. For a hero's own
 * theme, only that hero can target it, so there's no stacking — but we
 * still register via the accumulator so it stays uniform.
 *
 * Clamp at the track max so the final mark always lands on the completion
 * boundary that `detectTrackCompletion` watches. Any extra marks that
 * would push past the max in the same pack-up are lost; the standing chat
 * card must be resolved before more marks can land.
 */
function bumpTrack(track, theme, owner, accum, ops, sourceHero) {
	const max = trackMax(track);
	const map = accum[track];
	const key = `${owner.id}::${theme.id}`;
	const existing = map.get(key);
	if (existing) {
		existing.newValue = Math.min(existing.newValue + 1, max);
		return existing.newValue;
	}
	const newValue = Math.min((theme.system?.[track]?.value ?? 0) + 1, max);
	if (track === "improve") {
		const entry = { theme, owner, newValue };
		map.set(key, entry);
		ops.improves.push(entry);
		return newValue;
	}
	const entry = { theme, owner, track, newValue, sourceHero };
	map.set(key, entry);
	ops.questMarks.push(entry);
	return newValue;
}

function buildReflectOps(act, hero, state, world, trackAccum, ops, lines) {
	// Core Book p.181:
	//   Camp     → Mark Improve on the chosen theme.
	//   Sojourn  → Gain an improvement directly. Drive the existing
	//              improve-track-complete chat-card flow so the player
	//              uses ThemeAdvancementApp to pick their actual improvement.
	const improve = resolveReflectTheme(act.reflectTargetItemId, hero, world);
	if (improve.theme && improve.owner) {
		const { theme, owner, isFellowshipTarget } = improve;
		const themeName = isFellowshipTarget
			? `${owner.name}: ${theme.name}`
			: theme.name;
		if (state.type === "sojourn") {
			ops.improvements.push({ theme, owner, sourceHero: hero });
			lines.push({ kind: "reflect-improvement", themeName });
		} else {
			const newValue = bumpTrack(
				"improve",
				theme,
				owner,
				trackAccum,
				ops,
				hero,
			);
			lines.push({ kind: "reflect", themeName, newValue });
		}
	}

	// Quest marks — Sojourn Reflect lets players also mark Abandon /
	// Milestone "if the player sees fit to do so" (Core Book p.181).
	// Camp Reflect grants only Improve, so we skip the picker on camp
	// and gate the apply path here too in case a stale state slips through.
	if (state.type === "camp") return;
	for (const track of ["abandon", "milestone"]) {
		const targetId =
			track === "abandon"
				? act.reflectAbandonItemId
				: act.reflectMilestoneItemId;
		const resolved = resolveReflectTheme(targetId, hero, world);
		if (!resolved.theme || !resolved.owner) continue;
		const { theme, owner, isFellowshipTarget } = resolved;
		const themeName = isFellowshipTarget
			? `${owner.name}: ${theme.name}`
			: theme.name;
		const newValue = bumpTrack(track, theme, owner, trackAccum, ops, hero);
		lines.push({
			kind: "reflect-quest-mark",
			track,
			themeName,
			newValue,
		});
	}
}

/**
 * Fellowship Quality Time: each hero performs at most one of three exclusive
 * actions per camp. The hero's stored qualityTime selection drives a single op
 * — no auto-renewal of every relationship, no shotgun rename of every
 * fellowship tag. Invalid / unmatched selections (e.g. stale ids after the
 * fellowship theme changed) are silently dropped.
 */
function buildQualityTimeOps(hero, heroState, world, ops, qtStage) {
	const quality = heroState.qualityTime ?? null;
	if (!quality?.action) return;
	const allFx = collectEffects(hero);
	const lines = [];

	if (quality.action === "recoverFellowship") {
		const effect = allFx.find(
			(e) =>
				e.id === quality.fellowshipTagId &&
				e.type === "fellowship_tag" &&
				e.system?.isScratched,
		);
		if (effect) {
			ops.unscratches.push({ effect });
			lines.push({ kind: "fellowship-tag-recovered", name: effect.name });
		}
	} else if (quality.action === "rephraseRelationship") {
		const effect = allFx.find(
			(e) =>
				e.id === quality.relationshipEffectId && e.type === "relationship_tag",
		);
		if (effect) {
			// Unscratch is a no-op for an already-fresh relationship
			// (applyScratchBatch short-circuits when current === target).
			ops.unscratches.push({ effect });
			const next = quality.relationshipRephrase?.trim();
			if (next && next !== effect.name) {
				ops.renames.push({ effect, newName: next });
				lines.push({
					kind: "relationship-rephrased",
					from: effect.name,
					to: next,
				});
			} else {
				lines.push({ kind: "relationship-renewed", name: effect.name });
			}
		}
	} else if (quality.action === "newRelationship") {
		const allHeroes = world.heroes ?? [];
		const targetId = quality.newRelationshipTargetId;
		const name = quality.newRelationshipName?.trim();
		const targetHero = targetId
			? allHeroes.find((h) => h.id === targetId)
			: null;
		const already = allFx.some(
			(e) => e.type === "relationship_tag" && e.system?.targetId === targetId,
		);
		if (targetHero && name && !already) {
			ops.relationshipCreations.push({ heroActor: hero, targetId, name });
			lines.push({
				kind: "relationship-created",
				name,
				partnerName: targetHero.name,
			});
		}
	}

	if (lines.length) qtStage.heroes.push({ ...heroRef(hero), lines });
}

/**
 * Apply the operations against live Foundry documents. Embedded-doc work
 * is grouped by parent so each parent sees at most one update/delete
 * round-trip per op kind — fewer renders, fewer hook fires, atomic per
 * parent.
 */
export async function applyOperations(operations) {
	// Status reductions — calculate new tier arrays, batch updates and
	// deletes by parent.
	const statusUpdatesByParent = new Map();
	const statusDeletesByParent = new Map();
	for (const { effect, amount } of operations.statusReductions) {
		const newTiers = effect.system?.calculateReduction?.(amount);
		if (!newTiers) continue;
		const parent = effect.parent;
		if (newTiers.some((t) => t)) {
			groupByParent(statusUpdatesByParent, parent, {
				_id: effect.id,
				"system.tiers": newTiers,
			});
		} else {
			groupByParent(statusDeletesByParent, parent, effect.id);
		}
	}
	for (const { effect } of operations.statusDeletes) {
		groupByParent(statusDeletesByParent, effect.parent, effect.id);
	}
	for (const [parent, updates] of statusUpdatesByParent) {
		await parent.updateEmbeddedDocuments("ActiveEffect", updates);
	}
	for (const [parent, ids] of statusDeletesByParent) {
		await parent.deleteEmbeddedDocuments("ActiveEffect", ids);
	}

	// Unscratch — batch per parent. We bypass the
	// ScratchableMixin.toggleScratch wrapper because the existing camping
	// code already wrote system.isScratched directly (no pre/post hooks
	// were ever fired from here).
	await applyScratchBatch(operations.unscratches, false);

	// Disables — backpack tags the hero didn't keep. Foundry's standard
	// `disabled: true` so the entry stays on the bag and can be re-enabled
	// later instead of being consumed.
	const disablesByParent = new Map();
	for (const { effect } of operations.disables) {
		groupByParent(disablesByParent, effect.parent, {
			_id: effect.id,
			disabled: true,
		});
	}
	for (const [parent, updates] of disablesByParent) {
		await parent.updateEmbeddedDocuments("ActiveEffect", updates);
	}

	// Enables — previously-deactivated backpack tags the hero ticked to
	// bring back into circulation. Mirrors disables; same grouping.
	const enablesByParent = new Map();
	for (const { effect } of operations.enables) {
		groupByParent(enablesByParent, effect.parent, {
			_id: effect.id,
			disabled: false,
		});
	}
	for (const [parent, updates] of enablesByParent) {
		await parent.updateEmbeddedDocuments("ActiveEffect", updates);
	}

	// Renames — group by parent.
	const renamesByParent = new Map();
	for (const { effect, newName } of operations.renames) {
		groupByParent(renamesByParent, effect.parent, {
			_id: effect.id,
			name: newName,
		});
	}
	for (const [parent, updates] of renamesByParent) {
		await parent.updateEmbeddedDocuments("ActiveEffect", updates);
	}

	// Camp-mode Improves — `bumpTrack` already clamped newValue at the
	// track max, so the third mark lands exactly on the boundary
	// `detectTrackCompletion` checks.
	for (const { theme, owner, newValue } of operations.improves) {
		await owner.updateEmbeddedDocuments("Item", [
			{ _id: theme.id, "system.improve.value": newValue },
		]);
		const trackInfo = detectTrackCompletion(
			"system.improve.value",
			newValue,
			theme,
			owner,
		);
		if (trackInfo)
			Hooks.callAll("litm.trackCompleted", { actor: owner, trackInfo });
	}

	// Abandon / Milestone Quest marks from Reflect — same clamp +
	// completion semantics as Improve. Opens the standard
	// evolve/replace chat card via the existing track-complete renderer.
	for (const {
		theme,
		owner,
		track,
		newValue,
		sourceHero,
	} of operations.questMarks) {
		const attrib = `system.${track}.value`;
		await owner.updateEmbeddedDocuments("Item", [
			{ _id: theme.id, [attrib]: newValue },
		]);
		const trackInfo = detectTrackCompletion(attrib, newValue, theme, owner);
		if (trackInfo) {
			Hooks.callAll("litm.trackCompleted", {
				actor: sourceHero ?? owner,
				trackInfo,
			});
		}
	}

	// Sojourn-mode Improvements — fill the improve track and fire
	// `litm.trackCompleted` so the standard "Choose Improvement" chat
	// card opens ThemeAdvancementApp for the player. Per Core Book p.181
	// each hero's sojourn-Reflect grants an independent improvement, so
	// we fire one card per entry even when multiple heroes target the
	// same fellowship theme.
	//
	// Known limitation: if two heroes both target the SAME fellowship
	// theme on a sojourn, two chat cards are emitted but only the first
	// player to click the wizard can resolve theirs — the wizard's
	// `canSelect` gate is the configured improve threshold, and the first
	// resolution resets the track to 0. A proper fix would track pending
	// improvements per-theme so the second player can also pick. For
	// now the rare double-target case requires GM coordination.
	const improveMax = trackMax("improve");
	for (const { theme, owner, sourceHero } of operations.improvements) {
		const current = theme.system?.improve?.value ?? 0;
		if (current < improveMax) {
			await owner.updateEmbeddedDocuments("Item", [
				{ _id: theme.id, "system.improve.value": improveMax },
			]);
		}
		const trackInfo = detectTrackCompletion(
			"system.improve.value",
			improveMax,
			theme,
			owner,
		);
		if (trackInfo) {
			Hooks.callAll("litm.trackCompleted", {
				actor: sourceHero ?? owner,
				trackInfo,
			});
		}
	}

	// Relationship creations — batch per hero actor.
	const relsByActor = new Map();
	for (const {
		heroActor,
		targetId,
		name,
	} of operations.relationshipCreations) {
		if (!relsByActor.has(heroActor)) relsByActor.set(heroActor, []);
		relsByActor.get(heroActor).push(relationshipTagEffect({ name, targetId }));
	}
	for (const [actor, data] of relsByActor) {
		await actor.createEmbeddedDocuments("ActiveEffect", data);
	}

	// Sidebar refresh so scene tag changes appear immediately, both locally and on other clients
	getStoryTagSidebar()?.render?.();
	Sockets.dispatch("storyTagsRender", {});
}

function groupByParent(map, parent, payload) {
	if (!parent) return;
	if (!map.has(parent)) map.set(parent, []);
	map.get(parent).push(payload);
}

async function applyScratchBatch(entries, target) {
	const byParent = new Map();
	for (const { effect } of entries ?? []) {
		const current = !!effect.system?.isScratched;
		if (current === target) continue;
		groupByParent(byParent, effect.parent, {
			_id: effect.id,
			"system.isScratched": target,
		});
	}
	for (const [parent, updates] of byParent) {
		await parent.updateEmbeddedDocuments("ActiveEffect", updates);
	}
}
