import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveApprovedRoll } from "../modules/apps/roll/moderation.js";

const GM_ID = "gm-1";
const ME = "player-1";
const OTHER = "player-2";
const MESSAGE_ID = "msg-1";

/** Roll data as the requester's own client stored it on the moderation card. */
const STORED = { actorId: "hero-1", tags: { "tag-1": "positive" }, type: "quick" };

/** Pass `data: null` to model a card whose `data` flag was never written. */
function moderationMessage({ authorId = ME, data = STORED } = {}) {
	return {
		id: MESSAGE_ID,
		author: { id: authorId },
		getFlag: (scope, key) =>
			scope === "litmv2" && key === "data" ? (data ?? undefined) : undefined,
	};
}

function setWorld({ message = moderationMessage(), users = {} } = {}) {
	const roster = {
		[GM_ID]: { id: GM_ID, isGM: true },
		[ME]: { id: ME, isGM: false },
		[OTHER]: { id: OTHER, isGM: false },
		...users,
	};
	game.userId = ME;
	game.users.get = vi.fn((id) => roster[id]);
	game.messages.get = vi.fn((id) => (id === message?.id ? message : undefined));
}

beforeEach(() => {
	setWorld();
});

describe("resolveApprovedRoll", () => {
	it("returns the roll data stored on the requester's own moderation card", () => {
		expect(
			resolveApprovedRoll({
				senderId: GM_ID,
				userId: ME,
				messageId: MESSAGE_ID,
			}),
		).toEqual(STORED);
	});

	it("ignores roll data carried in the socket payload", () => {
		const forged = { actorId: "victim-hero", tags: { "burn-me": "positive" } };
		expect(
			resolveApprovedRoll({
				senderId: GM_ID,
				userId: ME,
				messageId: MESSAGE_ID,
				data: forged,
			}),
		).toEqual(STORED);
	});

	it("rejects a request that did not come from a GM", () => {
		expect(
			resolveApprovedRoll({
				senderId: OTHER,
				userId: ME,
				messageId: MESSAGE_ID,
			}),
		).toBeNull();
	});

	it("rejects a request from an unknown sender", () => {
		expect(
			resolveApprovedRoll({
				senderId: "ghost",
				userId: ME,
				messageId: MESSAGE_ID,
			}),
		).toBeNull();
	});

	it("rejects a request addressed to a different user", () => {
		expect(
			resolveApprovedRoll({
				senderId: GM_ID,
				userId: OTHER,
				messageId: MESSAGE_ID,
			}),
		).toBeNull();
	});

	it("rejects a moderation card authored by someone else", () => {
		setWorld({ message: moderationMessage({ authorId: OTHER }) });
		expect(
			resolveApprovedRoll({
				senderId: GM_ID,
				userId: ME,
				messageId: MESSAGE_ID,
			}),
		).toBeNull();
	});

	it("rejects a moderation card that no longer exists", () => {
		setWorld({ message: null });
		expect(
			resolveApprovedRoll({
				senderId: GM_ID,
				userId: ME,
				messageId: MESSAGE_ID,
			}),
		).toBeNull();
	});

	it("rejects a moderation card that carries no roll data", () => {
		setWorld({ message: moderationMessage({ data: null }) });
		expect(
			resolveApprovedRoll({
				senderId: GM_ID,
				userId: ME,
				messageId: MESSAGE_ID,
			}),
		).toBeNull();
	});
});
