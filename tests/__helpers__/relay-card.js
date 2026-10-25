// Fixtures for the GM-proxy relay guards (modules/system/relay-guards.js):
// the attested sender and the roll card a relay cites.

import { vi } from "vitest";
import { relayReceipts } from "../../modules/system/relay-guards.js";

export const PLAYER = { id: "player-1", isGM: false };

/** Fields that make a fake ChatMessage read as a litm roll card. */
export function rollCardFields({
	actorId = "h1",
	authorId = PLAYER.id,
	power = 10,
	canSpendPower = true,
	scratchedTags = [],
	powerTags = [],
	weaknessTags = [],
} = {}) {
	return {
		author: { id: authorId },
		rolls: [
			{
				litm: { actorId, scratchedTags, powerTags, weaknessTags },
				power,
				canSpendPower,
			},
		],
	};
}

/** Resolve `senderId` to `user`, and forget receipts from earlier tests. */
export function asSender(user = PLAYER, messageIds = ["m1"]) {
	game.users.get = vi.fn((id) => (id === user.id ? user : undefined));
	for (const id of messageIds) relayReceipts.forget(id);
}
