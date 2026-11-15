import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySpendIntent } from "../modules/apps/spend-power-service.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor } from "./__helpers__/factories.js";
import {
	counterOption,
	rollMessage,
	spendIntent,
} from "./__helpers__/spend-power.js";

// Two Spend Power windows can sit open on one roll. Each read `spentPower` when
// it opened, so the second to submit must add to what the first wrote, not to
// what it saw at the start.

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
	game.users.activeGM = null;
	game.user.isGM = false;
});

afterEach(() => {
	vi.restoreAllMocks();
});

/** An intent for `count` Discover a Detail, opened when `alreadySpent` was paid. */
const counterIntent = (alreadySpent, count) =>
	spendIntent(counterOption(count), { messageId: "m1", alreadySpent });

describe("applySpendIntent — spentPower flag", () => {
	it("adds to the flag as it stands at write time, not as the dialog opened", async () => {
		// The dialog opened with 0 spent; another window has since written 2.
		const message = rollMessage({ spentPower: 2 });
		const hero = fakeActor({ id: "h1" });

		await applySpendIntent(hero, counterIntent(0, 1));

		expect(message.setFlag).toHaveBeenCalledWith("litmv2", "spentPower", 3);
	});

	it("two windows opened on the same roll accumulate instead of overwriting", async () => {
		const message = rollMessage({ spentPower: 0 });
		const hero = fakeActor({ id: "h1" });

		// Both windows read alreadySpent = 0 when they opened.
		await applySpendIntent(hero, counterIntent(0, 2));
		await applySpendIntent(hero, counterIntent(0, 1));

		expect(message.setFlag).toHaveBeenNthCalledWith(
			1,
			"litmv2",
			"spentPower",
			2,
		);
		expect(message.setFlag).toHaveBeenNthCalledWith(
			2,
			"litmv2",
			"spentPower",
			3,
		);
	});

	it("treats a roll that never spent anything as 0", async () => {
		const message = rollMessage();
		const hero = fakeActor({ id: "h1" });

		await applySpendIntent(hero, counterIntent(0, 2));

		expect(message.setFlag).toHaveBeenCalledWith("litmv2", "spentPower", 2);
	});
});
