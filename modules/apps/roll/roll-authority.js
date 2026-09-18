/**
 * Who may change what inside one shared roll.
 *
 * The Narrator's Call is not a handoff any more — it is one roll object that
 * the Narrator and the roller look at together (Core Book p.269/p.272: the
 * Narrator decides the outcome method and invokes the opposition's tags, the
 * player invokes their own and rolls). Two people editing one window needs a
 * rule about whose half is whose:
 *
 * - The **Narrator's half** is the move type and the Might. Once a roll carries
 *   a narrator stamp those are the GM's alone, exactly as narrator-stamped tag
 *   invocations already are (`LitmRollDialog#canModifyTag`).
 * - The **roller's half** is their own tags, the modifier and Trade Power.
 *   Trade Power is a bargain a single roller strikes with the dice, so an
 *   Acting Together roll (p.157) has nobody to strike it.
 *
 * No Foundry globals here — unit-tested in `tests/roll-authority.test.js`.
 */

/**
 * Whether a roll carries a Narrator's stamp, i.e. the Narrator opened it and
 * owns the move and the Might.
 *
 * @param {{narratorUserId?: string|null}|null} [stamp]
 * @returns {boolean}
 */
export function isNarratorControlled(stamp) {
	return !!stamp?.narratorUserId;
}

/**
 * Whether this client may change the move type and the Might.
 *
 * A roll nobody called stays as it was: its owner sets both. A called roll
 * hands them to the Narrator and to nobody else — the roller owning the dialog
 * does not make the Narrator's judgement theirs to move.
 *
 * @param {object} args
 * @param {boolean} [args.isGM]
 * @param {boolean} [args.narratorControlled]
 * @param {boolean} [args.isOwner]
 * @returns {boolean}
 */
export function canEditNarratorFields({
	isGM = false,
	narratorControlled = false,
	isOwner = false,
} = {}) {
	if (isGM) return true;
	if (narratorControlled) return false;
	return !!isOwner;
}

/**
 * Whether this client may trade Power for position (Hedge / Caution).
 *
 * Owner-only as before, and never in a group roll: Acting Together resolves
 * one roll for the whole group, so there is no single roller to take the
 * hedge's cost or the caution's promise.
 *
 * @param {object} args
 * @param {boolean} [args.isOwner]
 * @param {boolean} [args.isGroupRoll]
 * @returns {boolean}
 */
export function canEditTradePower({
	isOwner = false,
	isGroupRoll = false,
} = {}) {
	return !!isOwner && !isGroupRoll;
}

/**
 * Decide who finishes a shared roll.
 *
 * A call is addressed to a Hero, not to a seat, so the dialog goes to an
 * *active, non-GM* owner of that Hero when there is one. When nobody is
 * connected to play them, it falls back to the Narrator, who rolls on the
 * Hero's behalf in the same window — post-roll writes to an unowned Hero are
 * already the GM's to make, so no extra authorization path is needed. An
 * Acting Together roll passes no owners and lands on the GM by the same route.
 *
 * @param {object} args
 * @param {{id: string, active?: boolean, isGM?: boolean}[]} [args.owners]
 *   Users with OWNER permission on the target actor.
 * @param {string|null} [args.gmUserId]  The calling Narrator's user id.
 * @returns {string|null} The user id that owns the dialog.
 */
export function resolveSharedRollOwner({ owners = [], gmUserId = null } = {}) {
	const activePlayer = owners.find((u) => u && !u.isGM && u.active);
	return activePlayer?.id ?? gmUserId ?? null;
}

/**
 * Whether a user may open a roll dialog on their own initiative.
 *
 * The `player_initiated_rolls` world setting exists because tables running the
 * Narrator's Call flow want the Narrator to be the only way in — p.269 puts
 * the choice of outcome method in the Narrator's hands, and a table can choose
 * to enforce that. The Narrator is never gated; a player is gated only when the
 * setting is off.
 *
 * This governs *instigation* only. Joining a roll another player already
 * opened, being called into one, reacting to a Consequence, and camp actions
 * are all still allowed — none of them start a roll unprompted.
 *
 * @param {{isGM?: boolean, playerInitiatedRolls?: boolean}} args
 * @returns {boolean}
 */
export function canInitiateRoll({ isGM = false, playerInitiatedRolls = true }) {
	return !!isGM || !!playerInitiatedRolls;
}

/**
 * Whether a player's Roll press has to go past the Narrator before it happens.
 *
 * Deliberately a separate setting from `player_initiated_rolls`: that one
 * decides whether a player may *start* composing a roll, this one whether the
 * roll they composed *executes*. A table can want either without the other — a
 * Narrator who calls every roll but trusts the dice once called, or one who
 * lets players reach for the dice but wants the last word on the total.
 *
 * The Narrator is never moderated, and neither is an Acting Together roll: the
 * Narrator owns that dialog and is the one pressing Roll.
 *
 * @param {object} args
 * @param {boolean} [args.isGM]
 * @param {boolean} [args.requireApproval]
 * @param {boolean} [args.isGroupRoll]
 * @returns {boolean}
 */
export function requiresRollApproval({
	isGM = false,
	requireApproval = false,
	isGroupRoll = false,
} = {}) {
	if (isGM || isGroupRoll) return false;
	return !!requireApproval;
}

/**
 * Whether the settings column (move bar, Might, modifiers) renders at all.
 * The roller needs it because it is their roll; the Narrator needs it on a
 * called roll even while watching as a non-owner, because the move and the
 * Might are theirs to set.
 *
 * @param {object} args
 * @param {boolean} [args.isOwner]
 * @param {boolean} [args.isGM]
 * @returns {boolean}
 */
export function showsRollSettings({ isOwner = false, isGM = false } = {}) {
	return !!isOwner || !!isGM;
}
