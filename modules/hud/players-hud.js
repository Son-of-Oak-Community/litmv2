/**
 * Mounting into Foundry's players panel.
 *
 * Two litm widgets live above the player list — the call-for-roll control and
 * the "click to join" strip for live rolls. That region is the right home for
 * both: it is the one place on screen already showing who is at the table, and
 * it costs no layout Foundry was not already spending, because `#players` is
 * anchored to the bottom-left and grows upward into canvas.
 *
 * **Order is CSS, not insertion.** `#players` is a `flexcol` whose own first
 * child is `#players-inactive`, the collapsed list that expands to 300px when
 * a user opens it. A widget merely prepended sits above that list and gets
 * shoved off the active roster the moment it expands. Negative `order` pins
 * both widgets above everything Foundry draws there in either state, and this
 * helper only has to guarantee presence.
 */

/**
 * Attach an element to the players panel, re-attaching it if Foundry has
 * re-rendered the panel out from under it.
 *
 * @param {HTMLElement} el
 * @returns {boolean} Whether the element is mounted.
 */
export function mountPlayersHud(el) {
	const parent = document.getElementById("players");
	if (!parent) return false;
	// Foundry replaces #players contents on re-render, detaching our node.
	if (el.parentElement !== parent) parent.prepend(el);
	return true;
}
