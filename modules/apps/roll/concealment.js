/**
 * What a roll may not tell the table.
 *
 * The Narrator invokes the opposition's tags (Core Book p.272), and some of
 * that opposition is deliberately concealed — the story-tag sidebar hides a
 * hidden actor's whole column from players. Those invocations still move the
 * Power, so they cannot simply be dropped: the arithmetic has to stay honest
 * while the source stays hidden.
 *
 * The roll dialog masks them as rows ("Something unseen-4"). The chat card the
 * roll produces has to mask them too, or the concealment lasts exactly as long
 * as it takes a player to open the tooltip — the tier is the part that matters
 * mechanically, the name is the part that gives the Narrator away.
 *
 * No Foundry globals here — unit-tested in `tests/concealment.test.js`.
 */

/**
 * Replace the names of tags belonging to actors this viewer may not see.
 *
 * The tier, polarity and everything else survive: what is masked is identity,
 * not magnitude. Scene tags remain visible; unresolved actor-backed historical
 * tags use their recorded policy, or fail closed when no policy was recorded.
 *
 * @param {object[]} tags  Tag entries as `LitmRoll` stores them.
 * @param {object} args
 * @param {Set<string>} args.concealedActorIds  Current hidden actor policy.
 * @param {boolean} args.isGM  Explicit viewer bypass, including recorded secrets.
 * @param {(tag: object) => string|null} args.resolveActorId
 * @param {string} args.maskName  What a concealed tag is called instead.
 * @returns {object[]} A new array when anything was masked, else the original.
 */
export function maskConcealedTags(
	tags,
	{ concealedActorIds, resolveActorId, maskName, isGM = false } = {},
) {
	if (!tags?.length) return tags ?? [];
	if (isGM) return tags;
	let masked = false;
	const result = tags.map((tag) => {
		if (!isTagConcealed(tag, { concealedActorIds, resolveActorId })) return tag;
		masked = true;
		return { ...tag, name: maskName, isConcealed: true };
	});
	return masked ? result : tags;
}

/**
 * Live sources follow the Narrator's current policy, including explicit reveals.
 * Sidebar removal retains that policy. When a source is gone, its recorded
 * policy is the fallback rather than silently revealing historical secrets.
 * Legacy actor-backed tags with a missing source fail closed; scene tags do not.
 */
export function isTagConcealed(
	tag,
	{ concealedActorIds, resolveActorId } = {},
) {
	const resolved = resolveActorId?.(tag);
	const actorId =
		resolved ?? tag.tagActorId ?? /^Actor\.([^.]+)\./.exec(tag.uuid ?? "")?.[1];
	if (actorId && concealedActorIds?.has(actorId)) return true;
	if (resolved) return false;
	if (tag.concealedAtRoll) return true;
	return (
		tag.concealedAtRoll === undefined &&
		(!!actorId || /^Scene\.[^.]+\.Token\./.test(tag.uuid ?? ""))
	);
}
