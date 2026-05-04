/**
 * Pure context builders used by `LitmRollDialog._prepareContext`. Lifted out
 * of the dialog so the view-model construction is testable independently of
 * the rendered application.
 */

/**
 * Build the compact display context for a linked Action document. Returns
 * `null` when the document isn't an Action item.
 *
 * The roll dialog only needs identity for the action header strip — the
 * description, examples, success entries, and consequences live in the
 * action sheet (one click away via the strip's view button) and the
 * post-roll chat panel. Tag suggestions decorate the existing tag picker
 * directly in `LitmRollDialog#buildTagGroups`, not via this context.
 *
 * @param {object} args
 * @param {Item|null|undefined} args.action  The linked action document.
 * @returns {object|null}
 */
export function buildActionContext({ action }) {
	if (!action || action.type !== "action") return null;
	const sys = action.system;
	return {
		uuid: action.uuid,
		name: action.name,
		img: action.img,
		isRote: sys.isRote,
		practitioners: sys.practitioners,
	};
}
