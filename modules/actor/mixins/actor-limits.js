/**
 * Shared logic for advancing/setting back a Limit's value, regardless of
 * where the limit lives. Two helpers — one for `system.limits` arrays
 * (challenges) and one for `flags.litmv2.limits` arrays (hero,
 * journey) — return the same shape so callers can treat them uniformly.
 *
 * @typedef {object} LimitChangeResult
 * @property {object} limit    The updated limit entry (post-clamp).
 * @property {number} value    The new clamped value.
 * @property {number} max      The limit's max (defaults to 6 if unset).
 * @property {boolean} immune  True when the limit's max is 0 — an immunity, so
 *                             nothing was written and `value` stays 0.
 * @property {boolean} reached True when this change carried the value from
 *                             below the max up to it (see {@link crossedLimitMax}).
 */

/**
 * The transition rule behind `litm.limitReached`: a limit is "reached" at the
 * moment its value crosses from below the max to at-or-above it — not while it
 * merely sits there, or every later write would announce it again. A max of 0
 * is an immunity (Core Book p.169) and is never reached.
 * @param {number} previousValue  The value before the change.
 * @param {number} nextValue      The value after it.
 * @param {number} max            The effective max.
 * @returns {boolean}
 */
export function crossedLimitMax(previousValue, nextValue, max) {
	if (!Number.isFinite(max) || max <= 0) return false;
	return (Number(previousValue) || 0) < max && (Number(nextValue) || 0) >= max;
}

/**
 * A limit's value: what its linked statuses stack to, plus the offset Advance
 * and Set Back left on it (`limit.advanced`, 0 when the limit has none). The
 * Core Book builds a Limit from statuses alone (p.169); Advance and Set Back
 * are the shortcut for a progress Limit nobody is giving a status. Keeping the
 * shortcut as an offset is what lets a later status change recompute the value
 * without erasing it.
 *
 * A Set Back can only take back what is there, so the offset is floored at the
 * negative of the statuses' value. Once the statuses are gone, the surplus Set
 * Back goes with them instead of discounting a status that lands later.
 *
 * @param {{ advanced?: number }} limit  The stored limit entry.
 * @param {number} statusValue           What the linked statuses stack to.
 * @returns {{ value: number, advanced: number }}
 */
export function resolveLimitValue(limit, statusValue) {
	const advanced = Math.max(Number(limit.advanced) || 0, -statusValue) || 0;
	return { value: statusValue + advanced, advanced };
}

/**
 * Announce a limit reached to this client's `litm.limitReached` listeners (the
 * GM whisper in chat-hooks among them). Callers fire only from the client that
 * made the write, so the announcement happens once per crossing.
 * @param {Actor} actor
 * @param {object} limit  The limit entry, with `max` set to the effective max.
 */
export function announceLimitReached(actor, limit) {
	Hooks.callAll("litm.limitReached", { actor, limit });
}

/**
 * Read the flag-backed limits array for the given actor.
 * @param {Actor} actor
 * @returns {object[]}
 */
export function getActorLimits(actor) {
	return actor.getFlag("litmv2", "limits") ?? [];
}

/**
 * Write the flag-backed limits array for the given actor.
 * @param {Actor} actor
 * @param {object[]} limits
 * @returns {Promise<Actor>}
 */
export function setActorLimits(actor, limits) {
	return actor.setFlag("litmv2", "limits", limits);
}

/**
 * Apply a delta to a flag-stored limit on the given actor. Returns the
 * change result, or `null` if the limit id wasn't found.
 * @param {Actor} actor
 * @param {string} limitId
 * @param {number} delta
 * @returns {Promise<LimitChangeResult|null>}
 */
export async function advanceFlagLimit(actor, limitId, delta, { max } = {}) {
	const limits = actor.getFlag("litmv2", "limits") ?? [];
	const result = _shiftLimit(limits, limitId, delta, max);
	if (!result) return null;
	if (!result.change.immune)
		await actor.setFlag("litmv2", "limits", result.updated);
	_announceIfReached(actor, result.change);
	return result.change;
}

/**
 * Apply a delta to a system-stored limit on the given actor. Returns the
 * change result, or `null` if the id was not found in the canonical
 * (non-derived) list — addon-derived limits are out of reach this way.
 * @param {Actor} actor
 * @param {string} limitId
 * @param {number} delta
 * @returns {Promise<LimitChangeResult|null>}
 */
export async function advanceSystemLimit(actor, limitId, delta) {
	// Read from _source to get the canonical (non-addon-derived) limits array.
	const limits = actor.system._source?.limits ?? [];
	const result = _shiftLimit(limits, limitId, delta);
	if (!result) return null;
	if (!result.change.immune)
		await actor.update({ "system.limits": result.updated });
	_announceIfReached(actor, result.change);
	return result.change;
}

function _announceIfReached(actor, change) {
	if (!change.reached) return;
	announceLimitReached(actor, { ...change.limit, max: change.max });
}

function _firstFinite(...candidates) {
	for (const candidate of candidates) {
		if (candidate === null || candidate === undefined || candidate === "")
			continue;
		const n = Number(candidate);
		if (Number.isFinite(n)) return n;
	}
	return 6;
}

function _shiftLimit(limits, limitId, delta, maxOverride) {
	const idx = limits.findIndex((l) => l.id === limitId);
	if (idx < 0) return null;
	const limit = limits[idx];
	// `maxOverride` lets a caller supply an effective max that differs from the
	// stored one — heroes derive theirs from the world's Hero Limit setting, so
	// a limit created under an older setting keeps a stale `max` on the flag.
	// A max of 0 is an *immunity* — the Core Book's "no maximum ( – )" Limit,
	// which no amount of the matching status can advance (p.169) — so test for
	// finiteness rather than truthiness, and report rather than write.
	const max = _firstFinite(maxOverride, limit.max);
	if (max === 0) {
		return {
			updated: limits,
			change: { limit, value: 0, max, immune: true, reached: false },
		};
	}
	const previous = Number(limit.value) || 0;
	// Advance stops at the max and Set Back at zero. A value already past the
	// max (a status stacked beyond it) is left where it is by an Advance, not
	// pulled back down to the max.
	const newValue =
		delta >= 0
			? Math.max(previous, Math.min(max, previous + delta))
			: Math.max(0, previous + delta);
	// The offset moves by what actually changed, after the clamps, so it never
	// records progress the limit did not make. The next recalc keeps it.
	const advanced = (Number(limit.advanced) || 0) + (newValue - previous);
	const updated = [...limits];
	updated[idx] = { ...limit, value: newValue, advanced };
	return {
		updated,
		change: {
			limit: updated[idx],
			value: newValue,
			max,
			immune: false,
			reached: crossedLimitMax(previous, newValue, max),
		},
	};
}
