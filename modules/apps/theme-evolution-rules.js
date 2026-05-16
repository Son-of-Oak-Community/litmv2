/**
 * Pure rules helpers for the Theme Evolution Wizard.
 *
 * No DOM or Foundry-document access; safe to unit-test. The wizard
 * (theme-evolution.js) glues these to documents and the UI; this
 * module owns the Core Book p.189-193 math.
 */

import { POWER_TAG_TYPES } from "../system/config.js";

export const POWER_BASELINE = 3;
export const WEAKNESS_BASELINE = 1;
export const PROMISE_MAX = 5;

/**
 * Determine which paths the player can pick. Always allows both so
 * "Inexorable Failure" (p.190) is supported.
 */
export function availableModes(theme) {
	const milestoneFull =
		(theme.system?.quest?.tracks?.milestone?.value ?? 0) >= 3;
	const abandonFull = (theme.system?.quest?.tracks?.abandon?.value ?? 0) >= 3;
	const defaultMode = abandonFull && !milestoneFull ? "replace" : "evolve";
	return { defaultMode, milestoneFull, abandonFull };
}

/**
 * Build the list of *revisable* parts: every non-title power tag, every
 * weakness tag, and every Special Improvement. All are tradable — the
 * Core Book rule "power tags beyond the third / weakness tags beyond the
 * first" caps the COUNT, not which specific tags. The player chooses;
 * the wizard enforces the cap via {@link getTradeCaps} and live UI.
 */
export function getRevisableParts(theme) {
	const allPower = [...theme.effects].filter(
		(e) => POWER_TAG_TYPES.has(e.type) && !e.system.isTitleTag,
	);
	const allWeakness = [...theme.effects].filter(
		(e) => e.type === "weakness_tag",
	);
	const specials = theme.system?.specialImprovements ?? [];

	const power = allPower.map((e) => ({
		kind: "power",
		id: e.id,
		name: e.name,
	}));
	const weakness = allWeakness.map((e) => ({
		kind: "weakness",
		id: e.id,
		name: e.name,
	}));
	const special = specials.map((si, idx) => ({
		kind: "special",
		id: String(idx),
		name: si.name || si.description || `#${idx + 1}`,
	}));

	return [...power, ...weakness, ...special];
}

/**
 * Maximum number of trade marks per kind for a given revisable list,
 * following the Core Book p.193 rule (power beyond third, weakness
 * beyond first, every special).
 */
export function getTradeCaps(revisable) {
	const counts = { power: 0, weakness: 0, special: 0 };
	for (const p of revisable) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
	return {
		power: Math.max(0, counts.power - POWER_BASELINE),
		weakness: Math.max(0, counts.weakness - WEAKNESS_BASELINE),
		special: counts.special,
	};
}

/** Sum of a trade-caps object. */
export function totalTradeCap(caps) {
	return caps.power + caps.weakness + caps.special;
}

/**
 * Apply Promise gain with overflow banking. The schema caps `promise`
 * at PROMISE_MAX; anything past that lives in `pendingPromise` until
 * the player resolves the Moment of Fulfillment (Core Book p.193).
 *
 * Returns an update payload + flags describing what happened, so the
 * caller can fire hooks / chat cards appropriately.
 */
export function applyPromiseGain({
	currentPromise = 0,
	currentPending = 0,
	gained = 0,
}) {
	const total = currentPromise + gained;
	const update = {};
	let banked = 0;
	if (total <= PROMISE_MAX) {
		update["system.promise"] = total;
	} else {
		update["system.promise"] = PROMISE_MAX;
		banked = total - PROMISE_MAX;
		update["system.pendingPromise"] = currentPending + banked;
	}
	return {
		update,
		newPromise: update["system.promise"],
		banked,
		reachedFulfillment:
			currentPromise < PROMISE_MAX && update["system.promise"] === PROMISE_MAX,
	};
}
