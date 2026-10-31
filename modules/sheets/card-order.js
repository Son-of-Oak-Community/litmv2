/**
 * Order of the Cards sheet's themes row: the hero's themes plus the
 * Fellowship card. The Fellowship theme lives on another actor, so its place
 * is a hero flag (the index of the theme it precedes) rather than an item
 * `sort`; every move reorders the whole row, then writes back both.
 */

/** Row key for the Fellowship card (item ids never collide with it). */
export const FELLOWSHIP_KEY = "fellowship";

/**
 * Clamp a stored slot to the current theme count. Unset means last.
 * @param {unknown} stored
 * @param {number} themeCount
 * @returns {number}
 */
export function fellowshipSlot(stored, themeCount) {
	if (!Number.isInteger(stored)) return themeCount;
	return Math.min(Math.max(stored, 0), themeCount);
}

/**
 * Move `source` onto `target`'s place in the row: before it when moving
 * left, after it when moving right, as Foundry's item sort places a dragged
 * item.
 * @param {string[]} order
 * @param {string} source
 * @param {string} target
 * @returns {string[]|null} The new order, or null when nothing moves.
 */
export function moveCard(order, source, target) {
	const from = order.indexOf(source);
	const to = order.indexOf(target);
	if (from < 0 || to < 0 || from === to) return null;
	const next = order.filter((key) => key !== source);
	next.splice(to, 0, source);
	return next;
}
