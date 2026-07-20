import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	applySpendIntent,
	handleApplyStatusAsGM,
} from "../modules/apps/spend-power-service.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";

// The service dispatches GM relays through Sockets; mock the module so tests
// can assert the relayed path without a live socket.
vi.mock("../modules/system/sockets.js", () => ({
	Sockets: { dispatch: vi.fn() },
}));

beforeEach(() => {
	vi.clearAllMocks();
	game.users.activeGM = null;
	game.user.isGM = false;
	game.user.id = "player-1";
	game.messages.get = vi.fn(() => null);
});

/** status_tag effect whose system quacks like StatusTagData for reduce. */
function fakeStatus({ id, name, tier, parent = null }) {
	const effect = fakeEffect({ id, name, type: "status_tag", parent });
	effect.system = {
		currentTier: tier,
		calculateReduction: vi.fn((by) => {
			const tiers = Array(6).fill(false);
			if (tier - by > 0) tiers[tier - by - 1] = true;
			return tiers;
		}),
		reduceTier: vi.fn(async () => {}),
	};
	return effect;
}

function statusPickerIntent(reductions) {
	return {
		options: [
			{
				kind: "statusPicker",
				optionId: "reduce_status",
				label: "LITM.Effects.reduce.action",
				cost: 1,
				reductions,
			},
		],
		messageId: null,
		alreadySpent: 0,
		targetActorId: null,
	};
}

function inflictIntent(entries, targetActorId) {
	return {
		options: [
			{
				kind: "default",
				optionId: "inflict_status",
				label: "LITM.Effects.inflict.action",
				cost: 1,
				hasTier: true,
				draggable: true,
				entries,
				targetActorId,
			},
		],
		messageId: null,
		alreadySpent: 0,
		targetActorId: null,
	};
}

describe("applySpendIntent — reduce_status owner routing", () => {
	it("reduces directly on an owned target and charges per tier", async () => {
		const status = fakeStatus({ id: "s1", name: "enraged", tier: 4 });
		const foe = fakeActor({
			id: "c1",
			name: "Serpent",
			effects: [status],
			isOwner: true,
		});
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		game.actors.get = vi.fn((id) => ({ h1: hero, c1: foe })[id] ?? null);

		const { results } = await applySpendIntent(
			hero,
			statusPickerIntent([
				{ effectId: "s1", name: "enraged", actorId: "c1", tiers: 2 },
			]),
		);

		expect(status.system.reduceTier).toHaveBeenCalledWith(2, {
			deleteOnEmpty: true,
		});
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(results[0].power).toBe(2);
		// The chat body names the foreign owner.
		expect(results[0].bodyLines[0]).toContain("Serpent: enraged");
	});

	it("relays an unowned reduction to the active GM and still charges", async () => {
		const status = fakeStatus({ id: "s1", name: "enraged", tier: 4 });
		const foe = fakeActor({
			id: "c1",
			name: "Serpent",
			effects: [status],
			isOwner: false,
		});
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		game.actors.get = vi.fn((id) => ({ h1: hero, c1: foe })[id] ?? null);
		game.users.activeGM = { id: "gm-1" };

		const { results } = await applySpendIntent(
			hero,
			statusPickerIntent([
				{ effectId: "s1", name: "enraged", actorId: "c1", tiers: 1 },
			]),
		);

		expect(status.system.reduceTier).not.toHaveBeenCalled();
		expect(Sockets.dispatch).toHaveBeenCalledWith("applyStatusAsGM", {
			op: "reduce",
			userId: "player-1",
			messageId: null,
			actorId: "c1",
			effectId: "s1",
			tiers: 1,
		});
		expect(results[0].power).toBe(1);
	});

	it("skips and does not charge when unowned and no GM is active", async () => {
		const status = fakeStatus({ id: "s1", name: "enraged", tier: 4 });
		const foe = fakeActor({
			id: "c1",
			name: "Serpent",
			effects: [status],
			isOwner: false,
		});
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		game.actors.get = vi.fn((id) => ({ h1: hero, c1: foe })[id] ?? null);

		const { results } = await applySpendIntent(
			hero,
			statusPickerIntent([
				{ effectId: "s1", name: "enraged", actorId: "c1", tiers: 1 },
			]),
		);

		expect(status.system.reduceTier).not.toHaveBeenCalled();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(results[0].power).toBe(0);
		expect(results[0].bodyLines).toEqual([]);
	});

	it("falls back to the rolling actor when a reduction carries no actorId", async () => {
		const status = fakeStatus({ id: "s1", name: "wounded", tier: 2 });
		const hero = fakeActor({ id: "h1", name: "Gerrin", effects: [status] });
		game.actors.get = vi.fn((id) => ({ h1: hero })[id] ?? null);

		const { results } = await applySpendIntent(
			hero,
			statusPickerIntent([
				{ effectId: "s1", name: "wounded", actorId: undefined, tiers: 2 },
			]),
		);

		expect(status.system.reduceTier).toHaveBeenCalled();
		expect(results[0].power).toBe(2);
		// Own statuses are not prefixed with an owner name.
		expect(results[0].bodyLines[0]).not.toContain("Gerrin:");
	});
});

describe("applySpendIntent — inflict_status targeting", () => {
	it("adds the status directly on an owned target and names it in the body", async () => {
		const foe = fakeActor({ id: "c1", name: "Serpent", isOwner: true });
		foe.system.addStatus = vi.fn(async () => {});
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		game.actors.get = vi.fn((id) => ({ h1: hero, c1: foe })[id] ?? null);

		const { results } = await applySpendIntent(
			hero,
			inflictIntent([{ name: "enraged", tier: 2, isSingleUse: false }], "c1"),
		);

		expect(foe.system.addStatus).toHaveBeenCalledWith("enraged", {
			tier: 2,
			isHidden: false,
		});
		expect(results[0].power).toBe(2);
		expect(results[0].body).toContain("Serpent");
		expect(results[0].body).toContain("[enraged-2]");
	});

	it("relays to the active GM when the target is unowned", async () => {
		const foe = fakeActor({ id: "c1", name: "Serpent", isOwner: false });
		foe.system.addStatus = vi.fn(async () => {});
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		game.actors.get = vi.fn((id) => ({ h1: hero, c1: foe })[id] ?? null);
		game.users.activeGM = { id: "gm-1" };

		const { results } = await applySpendIntent(
			hero,
			inflictIntent([{ name: "enraged", tier: 3, isSingleUse: false }], "c1"),
		);

		expect(foe.system.addStatus).not.toHaveBeenCalled();
		expect(Sockets.dispatch).toHaveBeenCalledWith("applyStatusAsGM", {
			op: "add",
			userId: "player-1",
			messageId: null,
			actorId: "c1",
			name: "enraged",
			tier: 3,
		});
		expect(results[0].power).toBe(3);
	});

	it("keeps the legacy chat-chip flow when no target is picked", async () => {
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		game.actors.get = vi.fn((id) => ({ h1: hero })[id] ?? null);

		const { results } = await applySpendIntent(
			hero,
			inflictIntent([{ name: "enraged", tier: 2, isSingleUse: false }], null),
		);

		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(results[0].body).toContain("[enraged-2]");
		expect(results[0].body).not.toContain("Gerrin");
		expect(results[0].power).toBe(2);
	});
});

describe("applySpendIntent — scratch on unowned owners", () => {
	function scratchIntent(chips) {
		return {
			options: [
				{
					kind: "scratchPicker",
					optionId: "scratch_tag",
					label: "LITM.Effects.scratch.action",
					cost: 2,
					chips,
				},
			],
			messageId: null,
			alreadySpent: 0,
			targetActorId: null,
		};
	}

	it("relays through scratchEffect instead of writing the effect directly", async () => {
		const tag = fakeEffect({ id: "t1", name: "reinforcements" });
		tag.system = { isScratched: false };
		const foe = fakeActor({
			id: "c1",
			name: "Serpent",
			effects: [tag],
			isOwner: false,
		});
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		game.actors.get = vi.fn((id) => ({ h1: hero, c1: foe })[id] ?? null);
		game.users.activeGM = { id: "gm-1" };

		const { results } = await applySpendIntent(
			hero,
			scratchIntent([
				{
					tagId: "t1",
					tagName: "reinforcements",
					actorId: "c1",
					isScene: false,
				},
			]),
		);

		expect(tag.update).not.toHaveBeenCalled();
		expect(Sockets.dispatch).toHaveBeenCalledWith("scratchEffect", {
			uuid: "Effect.t1",
		});
		expect(results[0].power).toBe(2);
	});

	it("skips and does not charge when unowned and no GM is active", async () => {
		const tag = fakeEffect({ id: "t1", name: "reinforcements" });
		tag.system = { isScratched: false };
		const foe = fakeActor({
			id: "c1",
			name: "Serpent",
			effects: [tag],
			isOwner: false,
		});
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		game.actors.get = vi.fn((id) => ({ h1: hero, c1: foe })[id] ?? null);

		const { results } = await applySpendIntent(
			hero,
			scratchIntent([
				{
					tagId: "t1",
					tagName: "reinforcements",
					actorId: "c1",
					isScene: false,
				},
			]),
		);

		expect(tag.update).not.toHaveBeenCalled();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(results[0].power).toBe(0);
	});
});

describe("handleApplyStatusAsGM — GM socket handler", () => {
	beforeEach(() => {
		game.user.isGM = true;
	});

	it("adds the status on the resolved actor", async () => {
		const foe = fakeActor({ id: "c1", name: "Serpent" });
		foe.system.addStatus = vi.fn(async () => {});
		game.actors.get = vi.fn((id) => ({ c1: foe })[id] ?? null);

		await handleApplyStatusAsGM({
			op: "add",
			userId: "player-1",
			messageId: "m1",
			actorId: "c1",
			name: "enraged",
			tier: 2,
		});

		expect(foe.system.addStatus).toHaveBeenCalledWith("enraged", {
			tier: 2,
			isHidden: false,
		});
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("reduces the resolved effect", async () => {
		const status = fakeStatus({ id: "s1", name: "enraged", tier: 4 });
		const foe = fakeActor({ id: "c1", name: "Serpent", effects: [status] });
		game.actors.get = vi.fn((id) => ({ c1: foe })[id] ?? null);

		await handleApplyStatusAsGM({
			op: "reduce",
			userId: "player-1",
			messageId: "m1",
			actorId: "c1",
			effectId: "s1",
			tiers: 2,
		});

		expect(status.system.reduceTier).toHaveBeenCalledWith(2, {
			deleteOnEmpty: true,
		});
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("whispers the acting player when the actor vanished", async () => {
		game.actors.get = vi.fn(() => null);

		await handleApplyStatusAsGM({
			op: "add",
			userId: "player-1",
			messageId: "m1",
			actorId: "gone",
			name: "enraged",
			tier: 2,
		});

		expect(foundry.documents.ChatMessage.create).toHaveBeenCalledWith(
			expect.objectContaining({
				whisper: ["player-1"],
				content: expect.stringContaining("LITM.Actions.apply_relay_nothing"),
			}),
		);
	});

	it("whispers the acting player when the effect vanished", async () => {
		const foe = fakeActor({ id: "c1", name: "Serpent", effects: [] });
		game.actors.get = vi.fn((id) => ({ c1: foe })[id] ?? null);

		await handleApplyStatusAsGM({
			op: "reduce",
			userId: "player-1",
			messageId: "m1",
			actorId: "c1",
			effectId: "gone",
			tiers: 1,
		});

		expect(foundry.documents.ChatMessage.create).toHaveBeenCalledWith(
			expect.objectContaining({
				whisper: ["player-1"],
				content: expect.stringContaining("LITM.Actions.apply_relay_nothing"),
			}),
		);
	});
});
