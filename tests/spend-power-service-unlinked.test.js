import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	applySpendIntent,
	handleApplyStatusAsGM,
	handleApplySuccessAsGM,
} from "../modules/apps/spend-power-service.js";
import { makeTagStringRe } from "../modules/system/config.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";

// An unlinked token's actor is synthetic: it has the world actor's id but is
// its own document, with its own effects and its own uuid. Every Spend Power
// write that names an actor must therefore resolve by uuid, locally and on the
// GM's client after a relay — resolving by id writes to the world actor (every
// copy, plus the sidebar column) or silently misses a token-only effect.
vi.mock("../modules/system/sockets.js", () => ({
	Sockets: { dispatch: vi.fn() },
}));

const WORLD_UUID = "Actor.bandit";
const TOKEN_UUID = "Scene.s1.Token.t1.Actor.bandit";

/** status_tag effect whose system quacks like StatusTagData for reduce. */
function fakeStatus({ id, name, tier }) {
	const effect = fakeEffect({ id, name, type: "status_tag" });
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

/**
 * A world actor "bandit" and one unlinked token's synthetic copy of it: same
 * id, different uuid, each with its own status of the same effect id.
 */
function banditWithToken({ owned = true } = {}) {
	const worldStatus = fakeStatus({ id: "s1", name: "enraged", tier: 4 });
	const tokenStatus = fakeStatus({ id: "s1", name: "enraged", tier: 2 });
	const world = fakeActor({
		id: "bandit",
		name: "Bandit",
		type: "challenge",
		effects: [worldStatus],
		isOwner: owned,
	});
	const token = fakeActor({
		id: "bandit",
		name: "Bandit",
		type: "challenge",
		effects: [tokenStatus],
		isOwner: owned,
	});
	token.uuid = TOKEN_UUID;
	world.system.addStatus = vi.fn(async () => {});
	token.system.addStatus = vi.fn(async () => {});
	const byUuid = { [WORLD_UUID]: world, [TOKEN_UUID]: token };
	foundry.utils.fromUuidSync.mockImplementation((uuid) => byUuid[uuid] ?? null);
	return { world, token, worldStatus, tokenStatus };
}

beforeEach(() => {
	vi.clearAllMocks();
	game.users.activeGM = null;
	game.user.isGM = false;
	game.user.id = "player-1";
	game.messages.get = vi.fn(() => null);
	foundry.utils.fromUuidSync.mockReset();
});

function wireWorld(...actors) {
	const byId = Object.fromEntries(actors.map((a) => [a.id, a]));
	game.actors.get = vi.fn((id) => byId[id] ?? null);
}

const statusIntent = (reductions) => ({
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
});

const scratchIntent = (chips) => ({
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
});

const inflictIntent = (extra) => ({
	options: [
		{
			kind: "default",
			optionId: "inflict_status",
			label: "LITM.Effects.inflict.action",
			cost: 1,
			hasTier: true,
			draggable: true,
			entries: [{ name: "dazed", tier: 2, isSingleUse: false }],
			targetActorId: null,
			...extra,
		},
	],
	messageId: null,
	alreadySpent: 0,
	targetActorId: null,
});

describe("reduce on an unlinked token", () => {
	it("reduces the token's own status, not the world actor's", async () => {
		const { world, token, worldStatus, tokenStatus } = banditWithToken();
		const hero = fakeActor({ id: "h1" });
		wireWorld(hero, world);

		const { results } = await applySpendIntent(
			hero,
			statusIntent([
				{
					effectId: "s1",
					name: "enraged",
					actorId: "bandit",
					actorUuid: TOKEN_UUID,
					tiers: 1,
				},
			]),
		);

		expect(tokenStatus.system.reduceTier).toHaveBeenCalledWith(1, {
			deleteOnEmpty: true,
		});
		expect(worldStatus.system.reduceTier).not.toHaveBeenCalled();
		expect(results[0].power).toBe(1);
		expect(token).toBeDefined();
	});

	it("relays the token's uuid when the player can't write it", async () => {
		const { world } = banditWithToken({ owned: false });
		const hero = fakeActor({ id: "h1" });
		wireWorld(hero, world);
		game.users.activeGM = { id: "gm-1" };

		await applySpendIntent(
			hero,
			statusIntent([
				{
					effectId: "s1",
					name: "enraged",
					actorId: "bandit",
					actorUuid: TOKEN_UUID,
					tiers: 1,
				},
			]),
		);

		expect(Sockets.dispatch).toHaveBeenCalledWith("applyStatusAsGM", {
			op: "reduce",
			userId: "player-1",
			messageId: null,
			actorId: "bandit",
			actorUuid: TOKEN_UUID,
			effectId: "s1",
			tiers: 1,
		});
	});

	it("skips, without billing or touching the world actor, when the token has vanished", async () => {
		const { world, worldStatus } = banditWithToken();
		const hero = fakeActor({ id: "h1" });
		wireWorld(hero, world);

		const { results, totalSpent } = await applySpendIntent(
			hero,
			statusIntent([
				{
					effectId: "s1",
					name: "enraged",
					actorId: "bandit",
					actorUuid: "Scene.s1.Token.gone.Actor.bandit",
					tiers: 1,
				},
			]),
		);

		expect(worldStatus.system.reduceTier).not.toHaveBeenCalled();
		expect(results[0].power).toBe(0);
		expect(totalSpent).toBe(0);
	});

	it("still resolves by id when the intent carries no uuid", async () => {
		const { world, worldStatus } = banditWithToken();
		const hero = fakeActor({ id: "h1" });
		wireWorld(hero, world);

		await applySpendIntent(
			hero,
			statusIntent([
				{ effectId: "s1", name: "enraged", actorId: "bandit", tiers: 1 },
			]),
		);

		expect(worldStatus.system.reduceTier).toHaveBeenCalledTimes(1);
	});
});

describe("applyStatusAsGM relay handler on an unlinked token", () => {
	beforeEach(() => {
		game.user.isGM = true;
	});

	it("reduces on the token actor named by uuid", async () => {
		const { world, worldStatus, tokenStatus } = banditWithToken();
		wireWorld(world);

		await handleApplyStatusAsGM({
			op: "reduce",
			userId: "player-1",
			actorId: "bandit",
			actorUuid: TOKEN_UUID,
			effectId: "s1",
			tiers: 1,
		});

		expect(tokenStatus.system.reduceTier).toHaveBeenCalledWith(1, {
			deleteOnEmpty: true,
		});
		expect(worldStatus.system.reduceTier).not.toHaveBeenCalled();
	});

	it("adds the status on the token actor named by uuid", async () => {
		const { world, token } = banditWithToken();
		wireWorld(world);

		await handleApplyStatusAsGM({
			op: "add",
			userId: "player-1",
			actorId: "bandit",
			actorUuid: TOKEN_UUID,
			name: "dazed",
			tier: 2,
		});

		expect(token.system.addStatus).toHaveBeenCalledWith("dazed", {
			tier: 2,
			isHidden: false,
		});
		expect(world.system.addStatus).not.toHaveBeenCalled();
	});

	it("whispers the player instead of falling back to the world actor when the token has vanished", async () => {
		const { world, worldStatus } = banditWithToken();
		wireWorld(world);

		await handleApplyStatusAsGM({
			op: "reduce",
			userId: "player-1",
			actorId: "bandit",
			actorUuid: "Scene.s1.Token.gone.Actor.bandit",
			effectId: "s1",
			tiers: 1,
		});

		expect(worldStatus.system.reduceTier).not.toHaveBeenCalled();
		expect(foundry.documents.ChatMessage.create).toHaveBeenCalledWith(
			expect.objectContaining({ whisper: ["player-1"] }),
		);
	});
});

describe("scratch on an unlinked token", () => {
	it("scratches a tag that exists only on the token", async () => {
		const { world, token } = banditWithToken();
		const tokenOnly = fakeEffect({ id: "t9", name: "ambush" });
		tokenOnly.parent = token;
		token.effects.push(tokenOnly);
		const hero = fakeActor({ id: "h1" });
		wireWorld(hero, world);

		const { results, totalSpent } = await applySpendIntent(
			hero,
			scratchIntent([
				{
					tagId: "t9",
					tagName: "ambush",
					actorId: "bandit",
					actorUuid: TOKEN_UUID,
				},
			]),
		);

		expect(tokenOnly.update).toHaveBeenCalledWith({
			"system.isScratched": true,
		});
		expect(results[0].power).toBe(2);
		expect(totalSpent).toBe(2);
	});

	it("skips, without billing, when the token has vanished", async () => {
		const { world } = banditWithToken();
		const sameIdOnWorld = fakeEffect({ id: "t9", name: "ambush" });
		sameIdOnWorld.parent = world;
		world.effects.push(sameIdOnWorld);
		const hero = fakeActor({ id: "h1" });
		wireWorld(hero, world);

		const { totalSpent } = await applySpendIntent(
			hero,
			scratchIntent([
				{
					tagId: "t9",
					tagName: "ambush",
					actorId: "bandit",
					actorUuid: "Scene.s1.Token.gone.Actor.bandit",
				},
			]),
		);

		expect(sameIdOnWorld.update).not.toHaveBeenCalled();
		expect(totalSpent).toBe(0);
	});
});

describe("inflict on an unlinked token", () => {
	it("adds the status to the token's actor", async () => {
		const { world, token } = banditWithToken();
		const hero = fakeActor({ id: "h1" });
		wireWorld(hero, world);

		const { results } = await applySpendIntent(
			hero,
			inflictIntent({ targetActorId: "bandit", targetActorUuid: TOKEN_UUID }),
		);

		expect(token.system.addStatus).toHaveBeenCalledWith("dazed", {
			tier: 2,
			isHidden: false,
		});
		expect(world.system.addStatus).not.toHaveBeenCalled();
		expect(results[0].power).toBe(2);
	});

	it("relays the token's uuid when the player can't write it", async () => {
		const { world } = banditWithToken({ owned: false });
		const hero = fakeActor({ id: "h1" });
		wireWorld(hero, world);
		game.users.activeGM = { id: "gm-1" };

		await applySpendIntent(
			hero,
			inflictIntent({ targetActorId: "bandit", targetActorUuid: TOKEN_UUID }),
		);

		expect(Sockets.dispatch).toHaveBeenCalledWith("applyStatusAsGM", {
			op: "add",
			userId: "player-1",
			messageId: null,
			actorId: "bandit",
			actorUuid: TOKEN_UUID,
			name: "dazed",
			tier: 2,
		});
	});

	it("skips, without billing, when the token has vanished", async () => {
		const { world } = banditWithToken();
		const hero = fakeActor({ id: "h1" });
		wireWorld(hero, world);

		const { results } = await applySpendIntent(
			hero,
			inflictIntent({
				targetActorId: "bandit",
				targetActorUuid: "Scene.s1.Token.gone.Actor.bandit",
			}),
		);

		expect(world.system.addStatus).not.toHaveBeenCalled();
		expect(results[0].power).toBe(0);
	});
});

describe("action success on an unlinked token", () => {
	beforeEach(() => {
		CONFIG.litmv2.tagStringRe = makeTagStringRe();
	});

	/** Roll message carrying the actionUuid flag and applied-success bookkeeping. */
	function wireRoll() {
		const flags = {
			actionUuid: "Item.act1",
			appliedSuccesses: [],
			appliedSuccessCosts: {},
		};
		const message = {
			id: "m1",
			getFlag: vi.fn((_scope, key) => flags[key]),
			update: vi.fn(async () => {}),
			setFlag: vi.fn(async () => {}),
		};
		game.messages.get = vi.fn((id) => (id === "m1" ? message : null));
		foundry.utils.fromUuid.mockResolvedValue({
			type: "action",
			name: "Sever Blessing",
			system: {
				successes: [{ id: "succ1", verb: "weaken", text: "Strip [Blessed-3]" }],
			},
		});
		return message;
	}

	/** World bandit and its token, each carrying a Blessed-3 status. */
	function blessedBandit({ owned = true } = {}) {
		const blessed = () =>
			fakeEffect({
				id: "b1",
				type: "status_tag",
				name: "Blessed",
				system: { tiers: [false, false, true, false, false, false] },
			});
		const worldStatus = blessed();
		const tokenStatus = blessed();
		const world = fakeActor({
			id: "bandit",
			name: "Bandit",
			effects: [worldStatus],
			isOwner: owned,
		});
		const token = fakeActor({
			id: "bandit",
			name: "Bandit",
			effects: [tokenStatus],
			isOwner: owned,
		});
		token.uuid = TOKEN_UUID;
		const byUuid = { [WORLD_UUID]: world, [TOKEN_UUID]: token };
		foundry.utils.fromUuidSync.mockImplementation((u) => byUuid[u] ?? null);
		return { world, token, worldStatus, tokenStatus };
	}

	const successIntent = (extra = {}) => ({
		options: [{ source: "action", successKey: "succ1", chosenTiers: [] }],
		messageId: "m1",
		alreadySpent: 0,
		targetActorId: "bandit",
		targetActorUuid: TOKEN_UUID,
		...extra,
	});

	it("applies to the token picked on the target row, not the world actor", async () => {
		const { world, worldStatus, tokenStatus } = blessedBandit();
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		wireWorld(hero, world);
		wireRoll();
		game.user.isGM = true;

		await applySpendIntent(hero, successIntent());

		expect(tokenStatus.delete).toHaveBeenCalled();
		expect(worldStatus.delete).not.toHaveBeenCalled();
	});

	it("relays the picked token's uuid when the player can't write it", async () => {
		const { world } = blessedBandit({ owned: false });
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		wireWorld(hero, world);
		wireRoll();
		game.users.activeGM = { id: "gm-1" };

		await applySpendIntent(hero, successIntent());

		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"applySuccessAsGM",
			expect.objectContaining({
				targetActorId: "bandit",
				targetActorUuid: TOKEN_UUID,
			}),
		);
	});

	describe("applySuccessAsGM relay handler", () => {
		beforeEach(() => {
			game.user.isGM = true;
		});

		const relay = (overrides = {}) => ({
			userId: "player-1",
			actorId: "h1",
			messageId: "m1",
			successKey: "succ1",
			targetActorId: "bandit",
			targetActorUuid: TOKEN_UUID,
			limitInfo: null,
			chosenTiers: [],
			chosenTags: null,
			...overrides,
		});

		it("applies to the token actor named by uuid", async () => {
			const { world, worldStatus, tokenStatus } = blessedBandit();
			const hero = fakeActor({ id: "h1", name: "Gerrin" });
			wireWorld(hero, world);
			wireRoll();

			await handleApplySuccessAsGM(relay());

			expect(tokenStatus.delete).toHaveBeenCalled();
			expect(worldStatus.delete).not.toHaveBeenCalled();
		});

		it("bails, rather than applying to the world actor, when the token has vanished", async () => {
			const { world, worldStatus } = blessedBandit();
			const hero = fakeActor({ id: "h1", name: "Gerrin" });
			wireWorld(hero, world);
			const message = wireRoll();

			await handleApplySuccessAsGM(
				relay({ targetActorUuid: "Scene.s1.Token.gone.Actor.bandit" }),
			);

			expect(worldStatus.delete).not.toHaveBeenCalled();
			expect(message.update).not.toHaveBeenCalled();
		});
	});
});
