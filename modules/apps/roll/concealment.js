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
 * not magnitude. A tag that resolves to no actor at all — a scene tag in the
 * story pack — is never concealed, because no hidden actor owns it.
 *
 * @param {object[]} tags  Tag entries as `LitmRoll` stores them.
 * @param {object} args
 * @param {Set<string>} args.concealedActorIds  Empty for a GM, who sees all.
 * @param {(tag: object) => string|null} args.resolveActorId
 * @param {string} args.maskName  What a concealed tag is called instead.
 * @returns {object[]} A new array when anything was masked, else the original.
 */
export function maskConcealedTags(
	tags,
	{ concealedActorIds, resolveActorId, maskName } = {},
) {
	if (!tags?.length) return tags ?? [];
	if (!concealedActorIds?.size) return tags;
	let masked = false;
	const result = tags.map((tag) => {
		const actorId = resolveActorId(tag);
		if (!actorId || !concealedActorIds.has(actorId)) return tag;
		masked = true;
		return { ...tag, name: maskName, isConcealed: true };
	});
	return masked ? result : tags;
}
