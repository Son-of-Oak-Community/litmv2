/**
 * Whether a hero description fits its collapsed clamp, so it needs neither
 * the fade nor a toggle. Measured against the clamp height, not the live box,
 * because the live box is unclamped in some layouts.
 * @param {number} scrollHeight  Full content height of the description body.
 * @param {number} clampPx       Height of the collapsed clamp (6em).
 * @returns {boolean}
 */
export function isDescriptionShort(scrollHeight, clampPx) {
	return scrollHeight <= clampPx;
}
