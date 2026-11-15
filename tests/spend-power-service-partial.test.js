import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applySpendIntent } from "../modules/apps/spend-power-service.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";
import {
	fakeTarget,
	inflictOption,
	recoverOption,
	reduceOption,
	rollMessage,
	scratchOption,
	spendIntent,
	wireActors,
} from "./__helpers__/spend-power.js";

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
	game.users.activeGM = null;
	game.user.isGM = false;
	game.user.id = "player-1";
});

afterEach(() => {
	vi.restoreAllMocks();
});

// The tests below open their dialog with `alreadySpent: 1`, which is what the
// message's spentPower flag holds.
const heldMessage = () => rollMessage({ spentPower: 1 });

/** Inflict [enraged-2] on `targetActorId`. */
const enrage = (targetActorId) =>
	inflictOption({
		entries: [{ name: "enraged", tier: 2, isSingleUse: false }],
		targetActorId,
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
		const message = heldMessage();
		const foe = fakeTarget();
		const hero = fakeActor({
			id: "h1",
			name: "Gerrin",
			effects: [rejectingStatus()],
		});
		wireActors(hero, foe);

		await expect(
			applySpendIntent(
				hero,
				spendIntent(
					[
						enrage("c1"),
						reduceOption([{ effectId: "s1", name: "wounded", tiers: 1 }]),
					],
					{ messageId: "m1", alreadySpent: 1 },
				),
			),
		).rejects.toThrow("write rejected");

		expect(foe.system.addStatus).toHaveBeenCalledTimes(1);
		expect(message.setFlag).toHaveBeenCalledTimes(1);
		expect(message.setFlag).toHaveBeenCalledWith("litmv2", "spentPower", 3);
	});

	it("writes nothing when the first option is the one that rejected", async () => {
		const message = heldMessage();
		const hero = fakeActor({
			id: "h1",
			name: "Gerrin",
			effects: [rejectingStatus()],
		});
		wireActors(hero);

		await expect(
			applySpendIntent(
				hero,
				spendIntent(
					reduceOption([{ effectId: "s1", name: "wounded", tiers: 1 }]),
					{ messageId: "m1" },
				),
			),
		).rejects.toThrow("write rejected");

		expect(message.setFlag).not.toHaveBeenCalled();
	});

	it("still records the full spend when every option lands", async () => {
		const message = heldMessage();
		const foe = fakeTarget();
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		wireActors(hero, foe);

		await applySpendIntent(
			hero,
			spendIntent(enrage("c1"), { messageId: "m1", alreadySpent: 1 }),
		);

		expect(message.setFlag).toHaveBeenCalledWith("litmv2", "spentPower", 3);
	});
});

describe("applySpendIntent — mid-option failure", () => {
	const intent = (option) =>
		spendIntent(option, { messageId: "m1", alreadySpent: 1 });

	it("records the entries of an Inflict that landed before a later entry rejected", async () => {
		const message = heldMessage();
		const foe = fakeActor({ id: "c1", name: "Serpent", isOwner: true });
		foe.system.addStatus = vi
			.fn()
			.mockResolvedValueOnce([])
			.mockRejectedValueOnce(new Error("write rejected"));
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		wireActors(hero, foe);

		await expect(
			applySpendIntent(
				hero,
				intent({
					...enrage("c1"),
					entries: [
						{ name: "enraged", tier: 2, isSingleUse: false },
						{ name: "bleeding", tier: 1, isSingleUse: false },
					],
				}),
			),
		).rejects.toThrow("write rejected");

		expect(foe.system.addStatus).toHaveBeenCalledTimes(2);
		expect(message.setFlag).toHaveBeenCalledWith("litmv2", "spentPower", 3);
	});

	it("records the reductions of a status picker that landed before a later one rejected", async () => {
		const message = heldMessage();
		const landed = fakeEffect({
			id: "s1",
			name: "wounded",
			type: "status_tag",
		});
		landed.system = {
			currentTier: 3,
			calculateReduction: vi.fn(() => Array(6).fill(false)),
			reduceTier: vi.fn(async () => {}),
		};
		const failing = fakeEffect({ id: "s2", name: "dazed", type: "status_tag" });
		failing.system = {
			currentTier: 2,
			calculateReduction: vi.fn(() => Array(6).fill(false)),
			reduceTier: vi.fn(async () => {
				throw new Error("write rejected");
			}),
		};
		const hero = fakeActor({
			id: "h1",
			name: "Gerrin",
			effects: [landed, failing],
		});
		wireActors(hero);

		await expect(
			applySpendIntent(
				hero,
				intent(
					reduceOption([
						{ effectId: "s1", name: "wounded", tiers: 2 },
						{ effectId: "s2", name: "dazed", tiers: 1 },
					]),
				),
			),
		).rejects.toThrow("write rejected");

		expect(message.setFlag).toHaveBeenCalledWith("litmv2", "spentPower", 3);
	});

	it("records the tags of a scratch picker that landed before a later one rejected", async () => {
		const message = heldMessage();
		const landed = fakeEffect({ id: "t1", name: "reinforcements" });
		const failing = fakeEffect({ id: "t2", name: "ambush" });
		failing.update = vi.fn().mockRejectedValue(new Error("write rejected"));
		const hero = fakeActor({
			id: "h1",
			name: "Gerrin",
			effects: [landed, failing],
		});
		wireActors(hero);

		await expect(
			applySpendIntent(
				hero,
				intent(
					scratchOption([
						{ tagId: "t1", tagName: "reinforcements", actorId: "h1" },
						{ tagId: "t2", tagName: "ambush", actorId: "h1" },
					]),
				),
			),
		).rejects.toThrow("write rejected");

		expect(landed.update).toHaveBeenCalledTimes(1);
		expect(message.setFlag).toHaveBeenCalledWith("litmv2", "spentPower", 3);
	});

	it("records the tags of a recover picker that landed before a later one rejected", async () => {
		const message = heldMessage();
		const landed = fakeEffect({ id: "t1", name: "reinforcements" });
		const failing = fakeEffect({ id: "t2", name: "ambush" });
		failing.update = vi.fn().mockRejectedValue(new Error("write rejected"));
		const hero = fakeActor({
			id: "h1",
			name: "Gerrin",
			effects: [landed, failing],
		});
		wireActors(hero);

		await expect(
			applySpendIntent(
				hero,
				intent(
					recoverOption([
						{ tagId: "t1", tagName: "reinforcements" },
						{ tagId: "t2", tagName: "ambush" },
					]),
				),
			),
		).rejects.toThrow("write rejected");

		expect(landed.update).toHaveBeenCalledTimes(1);
		expect(message.setFlag).toHaveBeenCalledWith("litmv2", "spentPower", 3);
	});
});
