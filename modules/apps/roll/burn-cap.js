/**
 * Burn cap (Core Book p.158): a roll may burn at most one tag. "Burning" sets a
 * tag's roll-selection state to "scratched". These pure helpers let the three
 * tag-selection entry points (dialog cycle, dialog shift-burn, sheet
 * shift-burn) enforce that single rule consistently and testably.
 */

/**
 * Find a tag, other than `excludeId`, that is already burned in this roll.
 *
 * @param {Map<string, {state?: string}>} selectionMap  The roll's selection map.
 * @param {string} excludeId  The tag being changed (so it can be re-burned or
 *   toggled off without blocking itself).
 * @returns {string|null} The id of an already-burned tag, or null if none.
 */
export function findBurnedSelection(selectionMap, excludeId) {
	for (const [id, entry] of selectionMap) {
		if (id !== excludeId && entry?.state === "scratched") return id;
	}
	return null;
}

/**
 * The cycle state that follows "scratched" in a super-checkbox `states` order,
 * wrapping at the end. Used to skip past a blocked burn instead of trapping the
 * cursor: the GM power-tag cycle is `,positive,scratched,negative`, so skipping
 * scratched must land on "negative" (the Narrator inversion, p.76), while
 * cycles where scratched is last simply wrap back to "off".
 *
 * @param {string[]} states  Ordered cycle states (e.g. ["", "positive", "scratched", "negative"]).
 * @returns {string} The next state after "scratched", or "" if absent.
 */
export function nextStateAfterScratched(states) {
	const i = states.indexOf("scratched");
	if (i === -1) return "";
	return states[(i + 1) % states.length];
}
