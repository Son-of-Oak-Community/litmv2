import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySpendIntent } from "../modules/apps/spend-power-service.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";

vi.mock("../modules/system/sockets.js", () => ({
	Sockets: { dispatch: vi.fn() },
}));

beforeEach(() => {
	vi.clearAllMocks();
	game.users.activeGM = null;
	game.user.isGM = false;
	game.user.id = "player-1";
});

function rollMessage() {
	const message = { id: "m1", setFlag: vi.fn(async () => {}) };
	game.messages.get = vi.fn((id) => (id === "m1" ? message : null));
	return message;
}

const inflictOption = (targetActorId) => ({
	kind: "default",
	optionId: "inflict_status",
	cost: 1,
	hasTier: true,
	draggable: true,
	entries: [{ name: "enraged", tier: 2, isSingleUse: false }],
	targetActorId,
});

const reduceOption = (reductions) => ({
	kind: "statusPicker",
	optionId: "reduce_status",
	cost: 1,
	reductions,
});

/** status_tag whose reduceTier rejects, standing in for a failed write. */
function rejectingStatus() {
	const status = fakeEffect({ id: "s1", name: "wounded", type: "status_tag" });
	status.system = {
		currentTier: 3,
		calculateReduction: vi.fn(() => Array(6).fill(false)),
		reduceTier: vi.fn(async () => {
			throw new Error("write rejected");
		}),
	};
	return status;
}

describe("applySpendIntent — mid-sequence failure", () => {
	it("records the Power of options that landed before a later one rejected", async () => {
		const message = rollMessage();
		const foe = fakeActor({ id: "c1", name: "Serpent", isOwner: true });
		foe.system.addStatus = vi.fn(async () => {});
		const hero = fakeActor({
			id: "h1",
			name: "Gerrin",
			effects: [rejectingStatus()],
		});
		game.actors.get = vi.fn((id) => ({ h1: hero, c1: foe })[id] ?? null);

		await expect(
			applySpendIntent(hero, {
				options: [
					inflictOption("c1"),
					reduceOption([{ effectId: "s1", name: "wounded", tiers: 1 }]),
				],
				messageId: "m1",
				alreadySpent: 1,
				targetActorId: null,
			}),
		).rejects.toThrow("write rejected");

		expect(foe.system.addStatus).toHaveBeenCalledTimes(1);
		expect(message.setFlag).toHaveBeenCalledTimes(1);
		expect(message.setFlag).toHaveBeenCalledWith("litmv2", "spentPower", 3);
	});

	it("writes nothing when the first option is the one that rejected", async () => {
		const message = rollMessage();
		const hero = fakeActor({
			id: "h1",
			name: "Gerrin",
			effects: [rejectingStatus()],
		});
		game.actors.get = vi.fn((id) => ({ h1: hero })[id] ?? null);

		await expect(
			applySpendIntent(hero, {
				options: [
					reduceOption([{ effectId: "s1", name: "wounded", tiers: 1 }]),
				],
				messageId: "m1",
				alreadySpent: 0,
				targetActorId: null,
			}),
		).rejects.toThrow("write rejected");

		expect(message.setFlag).not.toHaveBeenCalled();
	});

	it("still records the full spend when every option lands", async () => {
		const message = rollMessage();
		const foe = fakeActor({ id: "c1", name: "Serpent", isOwner: true });
		foe.system.addStatus = vi.fn(async () => {});
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		game.actors.get = vi.fn((id) => ({ h1: hero, c1: foe })[id] ?? null);

		await applySpendIntent(hero, {
			options: [inflictOption("c1")],
			messageId: "m1",
			alreadySpent: 1,
			targetActorId: null,
		});

		expect(message.setFlag).toHaveBeenCalledWith("litmv2", "spentPower", 3);
	});
});
