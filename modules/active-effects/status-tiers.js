/**
 * Status track depth — the one place that knows how many boxes a status has.
 *
 * Deliberately Foundry-free (it only reads the `CONFIG` global, never
 * `foundry.*`), so pure data layers like the camping module can import it
 * without pulling in a DataModel class at load time.
 */

/** The six-box track of the Core Book, used before `CONFIG` exists. */
export const RAW_MAX_STATUS_TIER = 6;

/**
 * How many boxes a status track has in this world — derived from the Hero
 * Limit; see `CONFIG.litmv2.maxStatusTier`.
 * @returns {number}
 */
export function maxStatusTier() {
	return CONFIG?.litmv2?.maxStatusTier ?? RAW_MAX_STATUS_TIER;
}

/**
 * Coerce a value to a usable status tier.
 * @param {*} value
 * @param {object} [options]
 * @param {number} [options.min=0]  0 allows "no tier" (skip this status).
 * @param {number} [options.max]    Defaults to the world's track depth.
 * @returns {number}
 */
export function clampTier(value, { min = 0, max = maxStatusTier() } = {}) {
	const n = Math.trunc(Number(value));
	if (!Number.isFinite(n)) return min;
	return Math.max(min, Math.min(max, n));
}

/**
 * A tiers array grown to `length`, preserving existing marks. Never shrinks —
 * a mark someone already took survives the Hero Limit being lowered later.
 * @param {boolean[]} tiers
 * @param {number} [length]
 * @returns {boolean[]}
 */
export function padTiers(tiers, length = maxStatusTier()) {
	const source = Array.isArray(tiers) ? tiers : [];
	const size = Math.max(length, source.length);
	return Array.from({ length: size }, (_, i) => source[i] === true);
}
