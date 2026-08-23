/**
 * Pure rules behind the Narrator's Call — the GM-initiated roll flow.
 *
 * Core Book, "Arriving at a Quick Outcome: Supporting A Player's Roll"
 * (p.272): the Narrator decides whether an action resolves as a Simple,
 * Quick, or Detailed outcome (p.269), invokes the tags of "the target of the
 * action, the opposition, or the environment", and invokes a Hero's weakness
 * tags if the player did not. The player then invokes their own tags and
 * rolls. This module holds the parts of that handoff that don't need Foundry:
 * the move types, how a Narrator's picks serialise onto the wire, who ends up
 * rolling, and whether a player may start a roll unprompted.
 *
 * No Foundry globals here — everything is unit-tested in
 * `tests/narrator-call-rules.test.js`.
 */

/**
 * The move types a Narrator may call for, in presentation order. These are
 * the system's existing roll types: `quick` (Quick outcome), `tracked`
 * (Detailed outcome), `mitigate` (Reaction). Sacrifice is deliberately
 * absent — p.150 makes it a price the *player* elects to pay, never
 * something the Narrator calls for.
 * @type {readonly string[]}
 */
export const NARRATOR_CALL_TYPES = Object.freeze([
	"quick",
	"tracked",
	"mitigate",
]);

/** @param {string} type @returns {boolean} */
export function isNarratorCallType(type) {
	return NARRATOR_CALL_TYPES.includes(type);
}

/**
 * Coerce an arbitrary value to a valid move type, defaulting to Quick.
 * @param {string} type
 * @returns {string}
 */
export function normalizeCallType(type) {
	return isNarratorCallType(type) ? type : "quick";
}

/**
 * Serialise a Narrator's selection map into the wire entries the roll
 * dialog's `#selectionMap` consumes. Every entry is stamped with
 * `narrator: true` and the Narrator's user id, which is what makes the
 * selection theirs to change rather than the roller's (see
 * `LitmRollDialog#canModifyTag`).
 *
 * Unset selections are dropped — an empty state means "not invoked".
 *
 * @param {Map<string, {state: string}>|Iterable<[string, {state: string}]>} selections
 * @param {string} narratorUserId
 * @returns {[string, object][]} entries suitable for `new Map(entries)`
 */
export function buildNarratorSelections(selections, narratorUserId) {
	const entries = selections instanceof Map ? [...selections] : [...selections];
	return entries
		.filter(([, sel]) => !!sel?.state)
		.map(([uuid, sel]) => [
			uuid,
			{
				state: sel.state,
				contributorId: narratorUserId ?? null,
				narrator: true,
				effectUuid: sel.effectUuid ?? uuid,
				contributorActorId: null,
				contributorActorName: null,
				contributorActorImg: null,
			},
		]);
}

/**
 * Decide who finishes a called roll, and who should see the chat card.
 *
 * A Narrator's Call is addressed to a Hero, not to a seat — so the roll goes
 * to an *active, non-GM* owner of that Hero when there is one. When nobody is
 * connected to play them, the call falls back to the Narrator, who completes
 * the roll on the Hero's behalf in the same dialog (mutations of the unowned
 * Hero already route through the system's GM-proxy sockets).
 *
 * The whisper list is wider than the roller list on purpose: every owner gets
 * the card so an offline player finds the call waiting at login, and the
 * Narrator always keeps a copy of what they asked for.
 *
 * @param {object} args
 * @param {{id: string, active?: boolean, isGM?: boolean}[]} [args.owners]
 *   Users with OWNER permission on the target hero.
 * @param {string|null} [args.narratorUserId]
 * @returns {{mode: "player"|"narrator", rollerIds: string[], whisper: string[]}}
 */
export function resolveCallDelivery({
	owners = [],
	narratorUserId = null,
} = {}) {
	const activePlayers = owners.filter((u) => u && !u.isGM && u.active);
	const whisper = [
		...new Set(
			[...owners.map((u) => u?.id), narratorUserId].filter(
				(id) => typeof id === "string" && id.length > 0,
			),
		),
	];
	return {
		mode: activePlayers.length > 0 ? "player" : "narrator",
		rollerIds: activePlayers.map((u) => u.id),
		whisper,
	};
}

/**
 * Whether a user may open a roll dialog on their own initiative.
 *
 * The `player_initiated_rolls` world setting exists because tables running
 * the Narrator's Call flow want the Narrator to be the only way in — p.269
 * puts the choice of outcome method in the Narrator's hands, and a table can
 * choose to enforce that. The Narrator is never gated; a player is gated only
 * when the setting is off.
 *
 * This governs *instigation* only. Joining a roll another player already
 * opened, taking a Narrator's Call, reacting to a Consequence, and camp
 * actions are all still allowed — none of them start a roll unprompted.
 *
 * @param {{isGM?: boolean, playerInitiatedRolls?: boolean}} args
 * @returns {boolean}
 */
export function canInitiateRoll({ isGM = false, playerInitiatedRolls = true }) {
	return !!isGM || !!playerInitiatedRolls;
}

/**
 * Split the Narrator's invoked tags into the two lists the chat card and the
 * dialog banner read out — "helping" and "hindering". Polarity is the
 * selection state, matching `LitmRoll.filterTags`: a burned tag still helps.
 *
 * @param {{name?: string, state?: string, type?: string, value?: number}[]} tags
 * @returns {{helpful: object[], hindering: object[]}}
 */
export function summarizeNarratorTags(tags = []) {
	const helpful = [];
	const hindering = [];
	for (const tag of tags) {
		if (!tag?.name) continue;
		const entry = {
			name: tag.name,
			type: tag.type ?? "story_tag",
			value: tag.type === "status_tag" ? (tag.value ?? 0) : undefined,
			burned: tag.state === "scratched",
		};
		if (tag.state === "positive" || tag.state === "scratched") {
			helpful.push(entry);
		} else if (tag.state === "negative") {
			hindering.push(entry);
		}
	}
	return { helpful, hindering };
}
