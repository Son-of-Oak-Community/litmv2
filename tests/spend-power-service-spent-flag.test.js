import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySpendIntent } from "../modules/apps/spend-power-service.js";
import { fakeActor } from "./__helpers__/factories.js";

vi.mock("../modules/system/sockets.js", () => ({
	Sockets: { dispatch: vi.fn() },
}));

// Two Spend Power windows can sit open on one roll. Each read `spentPower` when
// it opened, so the second to submit must add to what the first wrote, not to
// what it saw at the start.

beforeEach(() => {
	vi.clearAllMocks();
	game.users.activeGM = null;
	game.user.isGM = false;
});

/** A roll message whose spentPower flag is whatever the test says it is now. */
function rollMessage(spentPower) {
	const flags = { spentPower };
	const message = {
		id: "m1",
		getFlag: vi.fn((_scope, key) => flags[key]),
		setFlag: vi.fn(async (_scope, key, value) => {
			flags[key] = value;
		}),
	};
	game.messages.get = vi.fn((id) => (id === "m1" ? message : null));
	return message;
}

const counterIntent = (alreadySpent, count) => ({
	options: [
		{
			kind: "counter",
			optionId: "discover_detail",
			label: "LITM.Effects.discover.action",
			cost: 1,
			count,
		},
	],
	messageId: "m1",
	alreadySpent,
	targetActorId: null,
});

describe("applySpendIntent — spentPower flag", () => {
	it("adds to the flag as it stands at write time, not as the dialog opened", async () => {
		// The dialog opened with 0 spent; another window has since written 2.
		const message = rollMessage(2);
		const hero = fakeActor({ id: "h1" });

		await applySpendIntent(hero, counterIntent(0, 1));

		expect(message.setFlag).toHaveBeenCalledWith("litmv2", "spentPower", 3);
	});

	it("two windows opened on the same roll accumulate instead of overwriting", async () => {
		const message = rollMessage(0);
		const hero = fakeActor({ id: "h1" });

		// Both windows read alreadySpent = 0 when they opened.
		await applySpendIntent(hero, counterIntent(0, 2));
		await applySpendIntent(hero, counterIntent(0, 1));

		expect(message.setFlag).toHaveBeenNthCalledWith(1, "litmv2", "spentPower", 2);
		expect(message.setFlag).toHaveBeenNthCalledWith(2, "litmv2", "spentPower", 3);
	});

	it("treats a roll that never spent anything as 0", async () => {
		const message = rollMessage(undefined);
		const hero = fakeActor({ id: "h1" });

		await applySpendIntent(hero, counterIntent(0, 2));

		expect(message.setFlag).toHaveBeenCalledWith("litmv2", "spentPower", 2);
	});
});
