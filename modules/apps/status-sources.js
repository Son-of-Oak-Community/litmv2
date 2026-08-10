/**
 * Sources for the "Reduce a status" Spend Power option: a player may reduce
 * their own statuses or those on any actor tracked by the story-tag sidebar.
 * Pure; the caller supplies the candidate actors (so this stays testable
 * without canvas/game). Owners with nothing to reduce are skipped.
 */

/** status_tag effects with a live tier on an actor. */
function activeStatuses(actor) {
	return (actor?.system?.statusEffects ?? []).filter(
		(e) => (e.system?.currentTier ?? 0) > 0,
	);
}

/**
 * Group reducible statuses by owner: the rolling actor first (isOwn), then
 * each candidate that carries any. Candidates are deduped against the rolling
 * actor by id.
 * @param {Actor} actor                          The rolling actor.
 * @param {{id:string,label:string,actor:Actor}[]} candidates  Target candidates.
 * @param {object} [options]
 * @param {(effect: object) => boolean} [options.statusFilter]  Extra filter for
 *        statuses (eg. visibility) — supplied by the caller so this module stays
 *        free of game/user globals. Applies to every group, the rolling actor's
 *        included: a Narrator-hidden status is already invisible on the hero's
 *        own sheet, so this picker must not be the surface that leaks it.
 * @returns {{ownerId:string,ownerName:string,isOwn:boolean,statuses:{id:string,name:string,tier:number}[]}[]}
 */
export function collectReducibleStatuses(
	actor,
	candidates = [],
	{ statusFilter = null } = {},
) {
	const toEntry = (e) => ({
		id: e.id,
		name: e.name,
		tier: e.system.currentTier,
	});
	const groups = [];
	const seen = new Set();

	const own = activeStatuses(actor).filter(
		(e) => !statusFilter || statusFilter(e),
	);
	if (actor && own.length) {
		groups.push({
			ownerId: actor.id,
			ownerName: actor.name,
			isOwn: true,
			statuses: own.map(toEntry),
		});
	}
	if (actor) seen.add(actor.id);

	for (const cand of candidates) {
		if (seen.has(cand.id)) continue;
		seen.add(cand.id);
		const statuses = activeStatuses(cand.actor).filter(
			(e) => !statusFilter || statusFilter(e),
		);
		if (!statuses.length) continue;
		groups.push({
			ownerId: cand.id,
			ownerName: cand.label,
			isOwn: false,
			statuses: statuses.map(toEntry),
		});
	}
	return groups;
}
