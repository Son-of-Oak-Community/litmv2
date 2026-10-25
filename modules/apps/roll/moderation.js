import { warn } from "../../logger.js";

/**
 * Authorize an approved moderation request and recover the roll it stands for.
 *
 * Every field of an inbound `system.litmv2` payload is client-authored; only
 * `senderId`, which `Sockets.on` takes from the server, is not. A `rollDice`
 * handler that trusts the payload's roll data lets any client make another
 * player's client execute an attacker-chosen roll: a chat card authored as the
 * victim, their single-use tags consumed, Improve marked. The GM-only check on the *sending* side is a
 * UI affordance, not a security boundary.
 *
 * So the payload names a request; it never carries one. The roll data is read
 * back from the moderation ChatMessage the receiving user authored themselves
 * when they sent the roll to the narrator. The worst a forged packet can
 * achieve is triggering a roll its victim already composed and submitted — no
 * attacker-chosen tags, no attacker-chosen actor — and the GM-origin check on
 * the attested sender closes that case to players.
 *
 * @param {object} payload
 * @param {string} payload.senderId   Server-attested id of the emitting user.
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
