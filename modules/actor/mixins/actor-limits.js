/**
 * Shared logic for advancing/setting back a Limit's value, regardless of
 * where the limit lives. Two helpers — one for `system.limits` arrays
 * (challenges) and one for `flags.litmv2.limits` arrays (hero, fellowship,
 * journey) — return the same shape so callers can treat them uniformly.
 *
 * @typedef {object} LimitChangeResult
 * @property {object} limit  The updated limit entry (post-clamp).
 * @property {number} value  The new clamped value.
 * @property {number} max    The limit's max (defaults to 6 if unset).
 */

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
	await actor.setFlag("litmv2", "limits", result.updated);
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
	await actor.update({ "system.limits": result.updated });
	return result.change;
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
	// A max of 0 is meaningful ("no maximum for that Limit", Core Book p.169),
	// so test for finiteness rather than truthiness at each step.
	const max = _firstFinite(maxOverride, limit.max, 6);
	const newValue = Math.max(
		0,
		Math.min(max, (Number(limit.value) || 0) + delta),
	);
	const updated = [...limits];
	updated[idx] = { ...limit, value: newValue };
	return {
		updated,
		change: { limit: updated[idx], value: newValue, max },
	};
}
