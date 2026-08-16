import { warn } from "../../logger.js";

/**
 * Authorize an approved moderation request and recover the roll it stands for.
 *
 * Foundry relays `system.litmv2` packets between clients without a
 * server-verified sender, so every field of an inbound payload — `senderId`
 * included — is client-authored. A `rollDice` handler that trusts the payload's
 * roll data lets any client make another player's client execute an
 * attacker-chosen roll: a chat card authored as the victim, their single-use
 * tags consumed, Improve marked. The GM-only check on the *sending* side is a
 * UI affordance, not a security boundary.
 *
 * So the payload names a request; it never carries one. The roll data is read
 * back from the moderation ChatMessage the receiving user authored themselves
 * when they sent the roll to the narrator. The worst a forged packet can
 * achieve is triggering a roll its victim already composed and submitted — no
 * attacker-chosen tags, no attacker-chosen actor. The GM-origin check on top
 * raises the bar for that residual case.
 *
 * @param {object} payload
 * @param {string} payload.senderId   Client-authored id of the emitting user.
 * @param {string} payload.userId     Id of the user the approval is addressed to.
 * @param {string} payload.messageId  Id of the moderation card being approved.
 * @returns {object|null} The stored roll data, or null when unauthorized.
 */
export function resolveApprovedRoll({ senderId, userId, messageId }) {
	if (userId !== game.userId) return null;
	if (!game.users.get(senderId)?.isGM) return null;

	const message = game.messages.get(messageId);
	if (!message) {
		warn(`Moderation card ${messageId} is gone; approved roll not executed.`);
		return null;
	}
	if (message.author?.id !== game.userId) return null;

	return message.getFlag("litmv2", "data") ?? null;
}
