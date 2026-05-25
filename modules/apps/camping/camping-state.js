/**
 * Pure data layer for the Camping & Sojourn scene.
 *
 * All exports are stateless functions that read/mutate a plain JS object
 * shaped like `canvas.scene.flags.litmv2.camping`. No Foundry calls live
 * here — the scene-flag persistence and socket sync layer in camping-scene.js
 * is responsible for that. Keeping the data layer Foundry-free lets us
 * unit-test the bug-prone bits without booting a game.
 */

const VALID_DURATIONS = new Set(["days", "weeks", "months"]);
const PERIOD_COUNT = 3; // Always 3 slots; thirdPeriodActive gates rendering/use.
const ONCE_PER_SCENE = new Set(["rest", "reflect"]);
const VALID_ACTIVE_STEPS = new Set([
	"period1",
	"period2",
	"period3",
	"qualityTime",
	"packUp",
]);

export function defaultCampingState() {
	return {
		// Two-phase lifecycle. "setup" is the GM's private prep screen
		// (campsite tags, threats, type/duration). "active" is the full
		// table-wide scene that includes hero columns. The GM transitions
		// setup → active via "Begin Camp", at which point the open socket
		// fires and players' clients render.
		phase: "setup",
		type: "camp",
		sojournDuration: "days",
		// Per-session id stamped on every scene effect created during the
		// active phase via `flags.litmv2.campId`. Pack Up uses it to sweep
		// tags/statuses the camp introduced (Core Book p.179: "old camp tags
		// don't survive into a new one"). Empty until Begin Camp generates one.
		campId: "",
		// Wizard step within the active phase. Setup → active transitions
		// initialize this to "period1"; the GM advances via Next/Prev or by
		// clicking any timeline entry. Players follow along; the value is
		// authoritative for everyone via the scene flag. See setActiveStep
		// + VALID_ACTIVE_STEPS for the full step set.
		activeStep: "period1",
		placeOfStay: {
			name: "",
			campsiteTags: "",
			// Narrator-declared Threats for the campsite (Core Book p.179):
			// ids of vignette items in the world (stored in a "Camping" folder).
			// Players see the threat text; GM additionally sees the consequences.
			threats: [],
			sceneTagsToExpire: [],
			// Effect ids created from `campsiteTags` at Begin Camp. Tracked
			// so Cancel can roll them back; Pack Up sweeps by campId instead.
			createdCampsiteEffectIds: [],
		},
		heroStates: {},
	};
}

export function defaultHeroState() {
	return {
		thirdPeriodActive: false,
		// Effect ids of backpack story tags the player has chosen to keep.
		// Default empty: the book treats camp/sojourn as the moment to expire
		// most story tags ("the hero is only supposed to select 1 before
		// packing up unless they create new ones through camp action"). On
		// Pack Up, any backpack story tag NOT in this list gets scratched.
		backpackKept: [],
		activities: Array.from({ length: PERIOD_COUNT }, defaultActivity),
		// Fellowship Quality Time: each hero picks AT MOST ONE of three mutually
		// exclusive actions per camp. Choosing one (or switching) clears the
		// sub-fields of the others — sub-fields only carry meaning while the
		// matching action is selected.
		qualityTime: defaultQualityTime(),
	};
}

export function defaultQualityTime() {
	return {
		// "" | "recoverFellowship" | "rephraseRelationship" | "newRelationship"
		action: "",
		// recoverFellowship: which scratched fellowship_tag to unscratch.
		fellowshipTagId: "",
		// rephraseRelationship: which scratched relationship_tag to revive,
		// with an optional new name (empty = keep current name).
		relationshipEffectId: "",
		relationshipRephrase: "",
		// newRelationship: which fellowship hero to forge a relationship
		// toward, and the name of the new relationship_tag.
		newRelationshipTargetId: "",
		newRelationshipName: "",
	};
}

const QUALITY_ACTIONS = new Set([
	"",
	"recoverFellowship",
	"rephraseRelationship",
	"newRelationship",
]);

const QUALITY_SUB_FIELDS = new Set([
	"fellowshipTagId",
	"relationshipEffectId",
	"relationshipRephrase",
	"newRelationshipTargetId",
	"newRelationshipName",
]);

function defaultActivity() {
	return {
		activity: null,
		campActionDetail: "",
		reflectTargetItemId: null,
		// Core Book p.181: Reflect "is also a good time to reflect on each
		// theme's Quest and mark Abandon or Milestone if the player sees fit."
		// These are independent of the Improve target — same theme or not.
		reflectAbandonItemId: null,
		reflectMilestoneItemId: null,
		restChoices: {},
		restRecoverTagIds: [],
	};
}

export function ensureHeroState(state, heroId) {
	if (!state.heroStates) state.heroStates = {};
	if (!state.heroStates[heroId]) {
		state.heroStates[heroId] = defaultHeroState();
	}
	return state.heroStates[heroId];
}

/**
 * Toggle whether a backpack story tag is set to be kept on Pack Up.
 * `kept = true` adds the id to the keep list; `kept = false` removes it.
 * Default (id absent from the list) means the tag will be scratched.
 */
export function setBackpackKept(state, heroId, effectId, kept) {
	const h = ensureHeroState(state, heroId);
	const ix = h.backpackKept.indexOf(effectId);
	if (kept && ix === -1) h.backpackKept.push(effectId);
	if (!kept && ix !== -1) h.backpackKept.splice(ix, 1);
}

/**
 * Returns true if another period in the same hero's plan already claims a
 * once-per-scene activity. Core Book p.181: Rest and Reflect can only be
 * chosen once per scene; Camp Action is unrestricted.
 */
function isClaimedElsewhere(heroState, period, activity) {
	if (!ONCE_PER_SCENE.has(activity)) return false;
	return heroState.activities.some(
		(a, ix) => ix !== period && a.activity === activity,
	);
}

export function setActivity(state, heroId, period, activity) {
	const h = ensureHeroState(state, heroId);
	const slot = h.activities[period];
	if (!slot) return;
	if (activity && isClaimedElsewhere(h, period, activity)) return;
	slot.activity = activity;
	slot.campActionDetail = "";
	slot.reflectTargetItemId = null;
	slot.reflectAbandonItemId = null;
	slot.reflectMilestoneItemId = null;
	slot.restChoices = {};
	slot.restRecoverTagIds = [];
}

export function setActivityDetail(state, heroId, period, detail) {
	const h = ensureHeroState(state, heroId);
	h.activities[period].campActionDetail = detail ?? "";
}

export function setReflectTarget(state, heroId, period, itemId) {
	const h = ensureHeroState(state, heroId);
	h.activities[period].reflectTargetItemId = itemId || null;
}

export function setReflectAbandon(state, heroId, period, itemId) {
	const h = ensureHeroState(state, heroId);
	h.activities[period].reflectAbandonItemId = itemId || null;
}

export function setReflectMilestone(state, heroId, period, itemId) {
	const h = ensureHeroState(state, heroId);
	h.activities[period].reflectMilestoneItemId = itemId || null;
}

export function setRestChoice(
	state,
	heroId,
	period,
	statusEffectId,
	{ action, amount, maxTier } = {},
) {
	const h = ensureHeroState(state, heroId);
	const slot = h.activities[period];
	if (!slot.restChoices) slot.restChoices = {};
	const raw = Number.isFinite(amount) ? Math.floor(amount) : 1;
	const cap = Number.isFinite(maxTier) && maxTier > 0 ? maxTier : 6;
	const safeAmount = Math.max(1, Math.min(raw, cap));
	slot.restChoices[statusEffectId] = {
		action: action ?? "",
		amount: safeAmount,
	};
}

/**
 * Stepper-style adjustment of a status's rest choice. `delta = -1` nudges
 * toward "reduce more / remove"; `delta = +1` nudges back toward "keep".
 * Internally stored as the canonical `{action, amount}` shape so apply
 * code stays unchanged. Action keys:
 *   - decrement = 0           → action="" (keep)
 *   - 0 < decrement < maxTier → action="reduce", amount=decrement
 *   - decrement = maxTier     → action="remove"
 */
export function adjustRestChoice(
	state,
	heroId,
	period,
	statusEffectId,
	{ delta = 0, maxTier = 6 } = {},
) {
	const h = ensureHeroState(state, heroId);
	const slot = h.activities[period];
	if (!slot.restChoices) slot.restChoices = {};
	const cap = Number.isFinite(maxTier) && maxTier > 0 ? maxTier : 6;
	const current = slot.restChoices[statusEffectId] ?? {
		action: "",
		amount: 1,
	};
	const currentDecrement =
		current.action === "remove"
			? cap
			: current.action === "reduce"
				? Math.max(1, Math.min(current.amount ?? 1, cap))
				: 0;
	const next = Math.max(
		0,
		Math.min(currentDecrement - Number(delta || 0), cap),
	);
	if (next === 0) {
		delete slot.restChoices[statusEffectId];
		return;
	}
	if (next >= cap) {
		slot.restChoices[statusEffectId] = { action: "remove", amount: cap };
		return;
	}
	slot.restChoices[statusEffectId] = { action: "reduce", amount: next };
}

export function setRestRecoverTag(state, heroId, period, effectId, on) {
	const h = ensureHeroState(state, heroId);
	const list = h.activities[period].restRecoverTagIds;
	const ix = list.indexOf(effectId);
	if (on && ix === -1) list.push(effectId);
	if (!on && ix !== -1) list.splice(ix, 1);
}

export function setThirdPeriod(state, heroId, on) {
	const h = ensureHeroState(state, heroId);
	h.thirdPeriodActive = !!on;
	if (!on) {
		h.activities[2] = defaultActivity();
	}
}

/**
 * Quality-time mutator. Writes a single named slot inside the per-hero
 * `qualityTime` object. Selecting an action ("action" field) clears the
 * sub-fields of the *other* actions so a leftover draft can't sneak through
 * when the player switches their choice. Sub-field writes are accepted only
 * when an action is currently selected — orphan drafts have no apply path.
 */
export function setQualityTime(state, heroId, field, value) {
	const h = ensureHeroState(state, heroId);
	if (!h.qualityTime) h.qualityTime = defaultQualityTime();
	if (field === "action") {
		const next = QUALITY_ACTIONS.has(value) ? value : "";
		if (next === h.qualityTime.action) return;
		const fresh = defaultQualityTime();
		fresh.action = next;
		h.qualityTime = fresh;
		return;
	}
	if (!QUALITY_SUB_FIELDS.has(field)) return;
	if (!h.qualityTime.action) return;
	h.qualityTime[field] = value ?? "";
}

export function setType(state, type) {
	state.type = type === "sojourn" ? "sojourn" : "camp";
	// Camp doesn't use a duration; reset on switch so reopening shows a clean default.
	if (state.type === "camp") state.sojournDuration = "days";
}

/**
 * Transition the camping lifecycle phase. "setup" → GM-only prep view;
 * "active" → table-wide scene with hero columns. Only valid values are
 * stored; anything else is ignored. Entering the active phase resets the
 * wizard back to step 1 so a freshly-begun camp always lands on Period 1
 * (resuming an in-flight camp uses the persisted activeStep).
 */
export function setPhase(state, phase) {
	if (phase !== "setup" && phase !== "active") return;
	const wasSetup = state.phase === "setup";
	state.phase = phase;
	if (wasSetup && phase === "active") state.activeStep = "period1";
}

/**
 * Set the wizard step inside the active phase. Rejects unknown step ids so
 * a stale socket payload or hand-edited flag can't park the UI on a step
 * the template doesn't know how to render.
 */
export function setActiveStep(state, step) {
	if (VALID_ACTIVE_STEPS.has(step)) state.activeStep = step;
}

/**
 * Ordered list of step ids for the current state. Period 3 is included
 * only when at least one hero has opted in via `thirdPeriodActive`; the
 * opt-in toggle lives in the Period 2 step row, so the timeline grows
 * reactively as players toggle it. Pure function — same input always
 * produces the same output, no Foundry calls.
 */
export function stepOrder(state) {
	const anyThirdPeriod = Object.values(state.heroStates ?? {}).some(
		(h) => h?.thirdPeriodActive,
	);
	// Keep Period 3 in the order if it's the current step even when no hero
	// is opted in any more — prevents an in-flight GM from being silently
	// teleported when the last hero unticks the toggle. Manual nav then
	// removes it on next render.
	const showThirdPeriod = anyThirdPeriod || state.activeStep === "period3";
	const ids = ["period1", "period2"];
	if (showThirdPeriod) ids.push("period3");
	ids.push("qualityTime", "packUp");
	return ids;
}

/**
 * Resolve the neighbour of the current step in either direction. Returns
 * the same step id when already at the edge (no overflow / underflow).
 * Used by Next/Prev footer handlers — keeping the math here keeps the
 * scene-side handler a one-liner.
 */
export function adjacentStep(state, direction) {
	const order = stepOrder(state);
	const ix = order.indexOf(state.activeStep);
	if (ix < 0) return order[0];
	if (direction === "next") return order[Math.min(ix + 1, order.length - 1)];
	if (direction === "prev") return order[Math.max(ix - 1, 0)];
	return state.activeStep;
}

export function setSojournDuration(state, duration) {
	if (VALID_DURATIONS.has(duration)) state.sojournDuration = duration;
}

export function setPlaceOfStayName(state, name) {
	state.placeOfStay.name = name ?? "";
}

/**
 * Store the campsite-tags string verbatim. Parsing into effect creation data
 * happens at pack-up time via `CONFIG.litmv2.tagStringRe` + `parseTagStringMatch`,
 * so the same `[name]` / `[name!]` / `[name-N]` syntax used everywhere else
 * works here. Core Book p.179 lists positive tags, negative tags, and statuses
 * all as legitimate place-of-stay attachments.
 */
export function setCampsiteTags(state, raw) {
	state.placeOfStay.campsiteTags = typeof raw === "string" ? raw : "";
}

/**
 * Add a vignette item id to the campsite's Threats list. No-ops on
 * non-strings or duplicates so the same vignette can be safely re-dropped.
 * Core Book p.179: "The Narrator can also make a Threat, such as gathering
 * clouds or howling beasts, which could erupt into Consequences during the
 * camping time or sojourn." Players see the threat's name + threat text;
 * the GM additionally sees the consequences.
 */
export function addThreatVignette(state, id) {
	if (typeof id !== "string" || !id) return;
	const list = state.placeOfStay.threats;
	if (!list.includes(id)) list.push(id);
}

/**
 * Remove a vignette id from the campsite's Threats list. The underlying
 * vignette item is not deleted — Cancel/Pack Up leave authored threats in
 * the world for reuse on future camps.
 */
export function removeThreatVignette(state, id) {
	const list = state.placeOfStay.threats;
	const ix = list.indexOf(id);
	if (ix !== -1) list.splice(ix, 1);
}

export function setSceneTagExpiry(state, effectId, on) {
	const list = state.placeOfStay.sceneTagsToExpire;
	const ix = list.indexOf(effectId);
	if (on && ix === -1) list.push(effectId);
	if (!on && ix !== -1) list.splice(ix, 1);
}

export function sojournPowerBonus(state) {
	if (state.type !== "sojourn") return 0;
	return { days: 1, weeks: 2, months: 3 }[state.sojournDuration] ?? 0;
}

/**
 * Dispatch table for all state mutations. Used by:
 *   1. the delegated change handler in camping-scene.js (template inputs
 *      carry `data-update="<key>"`),
 *   2. the GM-side socket listener that applies remote ops atomically
 *      against the current scene flag (no last-writer-wins clobbering).
 *
 * Each entry takes `(state, payload)` where `payload` is a plain object
 * extracted from the input element's dataset/value (or sent in the socket).
 */
export const SETTERS = {
	"set-type": (s, { value }) => setType(s, value),
	"set-phase": (s, { value }) => setPhase(s, value),
	"active-step": (s, { value }) => setActiveStep(s, value),
	"sojourn-duration": (s, { value }) => setSojournDuration(s, value),
	"place-of-stay-name": (s, { value }) => setPlaceOfStayName(s, value),
	"campsite-tags": (s, { value }) => setCampsiteTags(s, value),
	"threat-add": (s, { itemId }) => addThreatVignette(s, itemId),
	"threat-remove": (s, { itemId }) => removeThreatVignette(s, itemId),
	"scene-tag-expiry": (s, { effectId, on }) =>
		setSceneTagExpiry(s, effectId, on),
	"backpack-kept": (s, { heroId, effectId, kept }) =>
		setBackpackKept(s, heroId, effectId, kept),
	"third-period": (s, { heroId, on }) => setThirdPeriod(s, heroId, on),
	activity: (s, { heroId, period, activity }) =>
		setActivity(s, heroId, period, activity),
	"activity-detail": (s, { heroId, period, value }) =>
		setActivityDetail(s, heroId, period, value),
	// The Reflect picks use <select>s — the chosen theme id lands in
	// `value` (the option's value).
	"reflect-target": (s, { heroId, period, value }) =>
		setReflectTarget(s, heroId, period, value),
	"reflect-abandon": (s, { heroId, period, value }) =>
		setReflectAbandon(s, heroId, period, value),
	"reflect-milestone": (s, { heroId, period, value }) =>
		setReflectMilestone(s, heroId, period, value),
	"rest-choice": (s, p) =>
		setRestChoice(s, p.heroId, p.period, p.statusId, {
			action: p.action,
			amount: p.amount,
			maxTier: p.maxTier,
		}),
	"rest-tier-delta": (s, p) =>
		adjustRestChoice(s, p.heroId, p.period, p.statusId, {
			delta: p.delta,
			maxTier: p.maxTier,
		}),
	"rest-recover": (s, { heroId, period, effectId, on }) =>
		setRestRecoverTag(s, heroId, period, effectId, on),
	"quality-time": (s, { heroId, field, value }) =>
		setQualityTime(s, heroId, field, value),
};
