/**
 * Sources for the "Scratch a tag" Spend Power option: a player may scratch
 * (cross off) their own unscratched story/backpack tags, a target's, or a
 * scene (world-pack) story tag. Pure; the caller supplies the candidate actors
 * and pre-filtered scene tags (so this stays testable without canvas/game).
 * Owners with nothing to scratch are skipped.
 */

/** Unscratched story_tag effects on an actor (story + backpack are both story_tag). */
function unscratchedStoryTags(actor) {
	return (actor?.system?.storyTags ?? []).filter((e) => !e.system?.isScratched);
}

/**
 * Group scratchable story tags by owner: the rolling actor first (isOwn),
 * then each candidate that owns any. Candidates are deduped against the
 * rolling actor by id.
 * @param {Actor} actor                          The rolling actor.
 * @param {{id:string,label:string,actor:Actor}[]} candidates  Target candidates.
 * @param {{id:string,name:string}[]} sceneTags   Pre-filtered scene story tags
 *        (unscratched, visible) from the world story-tag pack.
 * @param {object} [options]
 * @param {(effect: object) => boolean} [options.tagFilter]  Extra filter for
 *        tags (eg. visibility) — the caller supplies it so this module stays
 *        free of game/user globals. Applies to every group, the rolling actor's
 *        included: a Narrator-hidden tag is already invisible on the hero's own
 *        sheet, so this picker must not be the surface that leaks it.
 * @returns {{ownerId:string,ownerName:string,isOwn:boolean,isScene?:boolean,tags:{id:string,name:string}[]}[]}
 */
export function collectScratchableTags(
	actor,
	candidates = [],
	sceneTags = [],
	{ tagFilter = null } = {},
) {
	const groups = [];
	const seen = new Set();

	const own = unscratchedStoryTags(actor).filter(
		(e) => !tagFilter || tagFilter(e),
	);
	if (actor && own.length) {
		groups.push({
			ownerId: actor.id,
			ownerName: actor.name,
			isOwn: true,
			tags: own.map((e) => ({ id: e.id, name: e.name })),
		});
	}
	if (actor) seen.add(actor.id);

	for (const cand of candidates) {
		if (seen.has(cand.id)) continue;
		seen.add(cand.id);
		const tags = unscratchedStoryTags(cand.actor).filter(
			(e) => !tagFilter || tagFilter(e),
		);
		if (!tags.length) continue;
		groups.push({
			ownerId: cand.id,
			ownerName: cand.label,
			isOwn: false,
			tags: tags.map((e) => ({ id: e.id, name: e.name })),
		});
	}

	// Scene story tags (world-pack) live on no actor — one shared group,
	// flagged isScene so the apply path routes the scratch through the
	// story-tag write fork instead of an actor effect update.
	if (sceneTags.length) {
		groups.push({
			ownerId: "",
			ownerName: "",
			isOwn: false,
			isScene: true,
			tags: sceneTags.map((t) => ({ id: t.id, name: t.name })),
		});
	}
	return groups;
}
