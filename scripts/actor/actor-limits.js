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
 * Apply a delta to a flag-stored limit on the given actor. Returns the
 * change result, or `null` if the limit id wasn't found.
 * @param {Actor} actor
 * @param {string} limitId
 * @param {number} delta
 * @returns {Promise<LimitChangeResult|null>}
 */
export async function advanceFlagLimit(actor, limitId, delta) {
	const limits = actor.getFlag("litmv2", "limits") ?? [];
	const result = _shiftLimit(limits, limitId, delta);
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
	const limits = actor.system.limits ?? [];
	const result = _shiftLimit(limits, limitId, delta);
	if (!result) return null;
	await actor.update({ "system.limits": result.updated });
	return result.change;
}

function _shiftLimit(limits, limitId, delta) {
	const idx = limits.findIndex((l) => l.id === limitId);
	if (idx < 0) return null;
	const limit = limits[idx];
	const max = Number(limit.max) || 6;
	const newValue = Math.max(0, Math.min(max, (Number(limit.value) || 0) + delta));
	const updated = [...limits];
	updated[idx] = { ...limit, value: newValue };
	return {
		updated,
		change: { limit: updated[idx], value: newValue, max },
	};
}
