import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applySpendIntent,
	handleApplyStatusAsGM,
} from "../modules/apps/spend-power-service.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor } from "./__helpers__/factories.js";

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

afterEach(() => {
	delete CONFIG.litmv2.maxStatusTier;
});

function inflictIntent(tier, targetActorId) {
	return {
		options: [
			{
				kind: "default",
				optionId: "inflict_status",
				cost: 1,
				hasTier: true,
				draggable: true,
				entries: [{ name: "enraged", tier, isSingleUse: false }],
				targetActorId,
			},
		],
		messageId: null,
		alreadySpent: 0,
		targetActorId: null,
	};
}

function setup({ isOwner = true } = {}) {
	const foe = fakeActor({ id: "c1", name: "Serpent", isOwner });
	foe.system.addStatus = vi.fn(async () => {});
	const hero = fakeActor({ id: "h1", name: "Gerrin" });
	game.actors.get = vi.fn((id) => ({ h1: hero, c1: foe })[id] ?? null);
	return { foe, hero };
}

describe("applySpendIntent — Inflict tier is clamped to the status track", () => {
	it("caps an over-tall tier at the track depth, in the write and the charge", async () => {
		const { foe, hero } = setup();

		const { results } = await applySpendIntent(hero, inflictIntent(9, "c1"));

		expect(foe.system.addStatus).toHaveBeenCalledWith("enraged", {
			tier: 6,
			isHidden: false,
		});
		expect(results[0].power).toBe(6);
		expect(results[0].body).toContain("[enraged-6]");
	});

	it("reads the world's track depth rather than a fixed six", async () => {
		CONFIG.litmv2.maxStatusTier = 8;
		const { foe, hero } = setup();

		const { results } = await applySpendIntent(hero, inflictIntent(9, "c1"));

		expect(foe.system.addStatus).toHaveBeenCalledWith("enraged", {
			tier: 8,
			isHidden: false,
		});
		expect(results[0].power).toBe(8);
	});

	it.each([0, -3, "abc", undefined])("floors tier %j at 1", async (tier) => {
		const { foe, hero } = setup();

		const { results } = await applySpendIntent(hero, inflictIntent(tier, "c1"));

		expect(foe.system.addStatus).toHaveBeenCalledWith("enraged", {
			tier: 1,
			isHidden: false,
		});
		expect(results[0].power).toBe(1);
	});

	it("sends the clamped tier through the GM relay", async () => {
		const { foe, hero } = setup({ isOwner: false });
		game.users.activeGM = { id: "gm-1" };

		const { results } = await applySpendIntent(hero, inflictIntent(9, "c1"));

		expect(foe.system.addStatus).not.toHaveBeenCalled();
		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"applyStatusAsGM",
			expect.objectContaining({ op: "add", name: "enraged", tier: 6 }),
		);
		expect(results[0].power).toBe(6);
	});

	it("clamps the draggable chip and its charge when no target is picked", async () => {
		const { hero } = setup();

		const { results } = await applySpendIntent(hero, inflictIntent(9, null));

		expect(results[0].body).toContain("[enraged-6]");
		expect(results[0].power).toBe(6);
	});
});

describe("handleApplyStatusAsGM — clamps a relayed add", () => {
	beforeEach(() => {
		game.user.isGM = true;
	});

	const relay = (tier) =>
		handleApplyStatusAsGM({
			op: "add",
			userId: "player-1",
			messageId: "m1",
			actorId: "c1",
			name: "enraged",
			tier,
		});

	it("caps a tier a stale or hand-built client sent", async () => {
		const { foe } = setup();

		await relay(99);

		expect(foe.system.addStatus).toHaveBeenCalledWith("enraged", {
			tier: 6,
			isHidden: false,
		});
	});

	it("reads the world's track depth", async () => {
		CONFIG.litmv2.maxStatusTier = 8;
		const { foe } = setup();

		await relay(99);

		expect(foe.system.addStatus).toHaveBeenCalledWith("enraged", {
			tier: 8,
			isHidden: false,
		});
	});

	it.each([0, "abc", undefined])("floors tier %j at 1", async (tier) => {
		const { foe } = setup();

		await relay(tier);

		expect(foe.system.addStatus).toHaveBeenCalledWith("enraged", {
			tier: 1,
			isHidden: false,
		});
	});
});
