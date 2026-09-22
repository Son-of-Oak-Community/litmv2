/**
 * Acting Together — the group roll (Core Book p.157).
 *
 * "When the whole group acts together toward the same goal, make a single
 * roll for the group." Each participating Hero contributes **one** tag, one
 * Hero may burn a tag for everyone, any or all of the Fellowship theme's
 * power tags may be invoked, and the outcome lands on the entire group.
 *
 * Distinct from Helping Each Other on the same page (+1 Power per helper, no
 * burn), which litmv2 already implements as contributed tags. The two do not
 * merge.
 *
 * This module holds the parts that don't need Foundry: who is in the roll,
 * whose tag a selection is, and the one-tag-per-Hero cap. The burn cap is not
 * here because it never needed to be — `findBurnedSelection` in `burn-cap.js`
 * already caps the whole selection map at one scratched tag, which is exactly
 * "one Hero may burn a tag for the whole roll".
 *
 * No Foundry globals here — unit-tested in `tests/group-roll.test.js`.
 */

/**
 * Normalise a GM's participant picks into the roll's participant list: hero
 * order preserved, unknown ids dropped, duplicates collapsed.
 *
 * Participants are a GM-selected subset, and an offline participant stays in
 * the roll — they simply contribute no tag. So presence is deliberately not
 * consulted here.
 *
 * @param {object} args
 * @param {{id: string}[]} [args.heroes]  Every hero, in the order to preserve.
 * @param {string[]} [args.selectedIds]   The GM's picks, in any order.
 * @returns {string[]} Participating hero ids.
 */
export function resolveGroupParticipants({
	heroes = [],
	selectedIds = [],
} = {}) {
	const picked = new Set(selectedIds.filter(Boolean));
	const seen = new Set();
	const result = [];
	for (const hero of heroes) {
		const id = hero?.id;
		if (!id || !picked.has(id) || seen.has(id)) continue;
		seen.add(id);
		result.push(id);
	}
	return result;
}

/**
 * Who is in an Acting Together roll: every Hero linked to the Fellowship.
 *
 * The Narrator used to tick a subset. Filip reversed that after playing it —
 * when the group acts together, the group acts together, and a subset is a
 * second decision the fiction never asked for. Helping Each Other (p.157, the
 * other half of that page) is the mechanic for "some of us pitch in", and
 * litmv2 already implements it as contributed tags.
 *
 * "Linked" mirrors `HeroData#fellowshipActor`: a Hero pointing at this
 * Fellowship, or one pointing at nothing at all, which falls back to the
 * singleton the same way. A Hero pointing at a *different* Fellowship is not
 * in this one's roll.
 *
 * Presence is deliberately not consulted — an offline Hero stays in the roll
 * and simply contributes no tag.
 *
 * @param {object} args
 * @param {{id: string, system?: {fellowshipId?: string|null}}[]} [args.heroes]
 * @param {string|null} [args.fellowshipId] The singleton Fellowship's id.
 * @returns {string[]} Participating hero ids, in hero order.
 */
export function resolveFellowshipParticipants({
	heroes = [],
	fellowshipId = null,
} = {}) {
	if (!fellowshipId) return [];
	const linked = heroes
		.filter((hero) => {
			const id = hero?.system?.fellowshipId;
			return !id || id === fellowshipId;
		})
		.map((hero) => hero.id);
	// Normalised through the same helper the GM-selected subset used, so hero
	// order and de-duplication have one definition.
	return resolveGroupParticipants({ heroes, selectedIds: linked });
}

/**
 * The one-tag-per-Hero cap.
 *
 * Each participating Hero contributes one tag to an Acting Together roll, and
 * a Fellowship *relationship* tag counts against that one — which falls out
 * for free, because relationship tags live on the Hero actor, so they resolve
 * to the same owner as any of that Hero's theme tags.
 *
 * Fellowship theme power tags are exempt: they live on the Fellowship actor,
 * which is never a participant, so `tagActorId` never matches a participating
 * Hero and the cap does not apply. Scene and opposition tags are exempt for
 * the same reason.
 *
 * @param {Iterable<[string, {state?: string, tagActorId?: string|null}]>} entries
 *   The roll's selection entries.
 * @param {object} args
 * @param {string|null} args.tagActorId  Actor the tag being selected belongs to.
 * @param {string} args.uuid             The tag being selected (so re-cycling
 *   a Hero's already-selected tag never blocks itself).
 * @param {string[]} [args.participantIds]
 * @returns {string|null} The uuid of the tag that already fills this Hero's
 *   slot, or null when the selection is allowed.
 */
export function findHeroTagConflict(
	entries,
	{ tagActorId, uuid, participantIds = [] } = {},
) {
	if (!tagActorId || !participantIds.includes(tagActorId)) return null;
	for (const [id, entry] of entries) {
		if (id === uuid) continue;
		if (!entry?.state) continue;
		if (entry.tagActorId === tagActorId) return id;
	}
	return null;
}
