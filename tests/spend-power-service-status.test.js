import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applySpendIntent,
	handleApplyStatusAsGM,
} from "../modules/apps/spend-power-service.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";
import {
	fakeStatus,
	fakeTarget,
	inflictIntent,
	reduceIntent,
	scratchIntent,
	wireActors,
} from "./__helpers__/spend-power.js";

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
	game.users.activeGM = null;
	game.user.isGM = false;
	game.user.id = "player-1";
	game.messages.get = vi.fn(() => null);
});

afterEach(() => {
	vi.restoreAllMocks();
});

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
		wireActors(hero, foe);

		const { results } = await applySpendIntent(
			hero,
			reduceIntent([
				{ effectId: "s1", name: "enraged", actorId: "c1", tiers: 2 },
			]),
		);

		expect(status.system.reduceTier).toHaveBeenCalledWith(2, {
			deleteOnEmpty: true,
		});
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(results[0].power).toBe(2);
		// The chat body names the foreign owner, then old tier → new tier.
		expect(results[0].bodyLines[0]).toBe(
			"<span>Serpent: enraged-4 &rarr; <strong>enraged-2</strong></span>",
		);
	});

	it("names a hidden status as unseen on the public card, tier kept", async () => {
		game.user.isGM = true;
		const status = fakeStatus({ id: "s1", name: "secret grace", tier: 4 });
		status.system.isHidden = true;
		const foe = fakeActor({
			id: "c1",
			name: "Serpent",
			effects: [status],
			isOwner: true,
		});
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		wireActors(hero, foe);

		const { results } = await applySpendIntent(
			hero,
			reduceIntent([
				{ effectId: "s1", name: "secret grace", actorId: "c1", tiers: 2 },
			]),
		);

		expect(status.system.reduceTier).toHaveBeenCalled();
		const [line] = results[0].bodyLines;
		expect(line).not.toContain("secret grace");
		expect(line).toContain("LITM.Ui.roll_concealed_tag-4");
		expect(line).toContain("LITM.Ui.roll_concealed_tag-2");
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
		wireActors(hero, foe);
		game.users.activeGM = { id: "gm-1" };

		const { results } = await applySpendIntent(
			hero,
			reduceIntent([
				{ effectId: "s1", name: "enraged", actorId: "c1", tiers: 1 },
			]),
		);

		expect(status.system.reduceTier).not.toHaveBeenCalled();
		expect(Sockets.dispatch).toHaveBeenCalledWith("applyStatusAsGM", {
			op: "reduce",
			userId: "player-1",
			messageId: null,
			actorId: "c1",
			actorUuid: "Actor.c1",
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
		wireActors(hero, foe);

		const { results } = await applySpendIntent(
			hero,
			reduceIntent([
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
		wireActors(hero);

		const { results } = await applySpendIntent(
			hero,
			reduceIntent([
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
		const foe = fakeTarget({ isOwner: true });
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		wireActors(hero, foe);

		const { results } = await applySpendIntent(
			hero,
			inflictIntent({
				entries: [{ name: "enraged", tier: 2, isSingleUse: false }],
				targetActorId: "c1",
			}),
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
		const foe = fakeTarget({ isOwner: false });
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		wireActors(hero, foe);
		game.users.activeGM = { id: "gm-1" };

		const { results } = await applySpendIntent(
			hero,
			inflictIntent({
				entries: [{ name: "enraged", tier: 3, isSingleUse: false }],
				targetActorId: "c1",
			}),
		);

		expect(foe.system.addStatus).not.toHaveBeenCalled();
		expect(Sockets.dispatch).toHaveBeenCalledWith("applyStatusAsGM", {
			op: "add",
			userId: "player-1",
			messageId: null,
			actorId: "c1",
			actorUuid: "Actor.c1",
			name: "enraged",
			tier: 3,
		});
		expect(results[0].power).toBe(3);
	});

	it("keeps the legacy chat-chip flow when no target is picked", async () => {
		const hero = fakeActor({ id: "h1", name: "Gerrin" });
		wireActors(hero);

		const { results } = await applySpendIntent(
			hero,
			inflictIntent({
				entries: [{ name: "enraged", tier: 2, isSingleUse: false }],
				targetActorId: null,
			}),
		);

		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(results[0].body).toContain("[enraged-2]");
		expect(results[0].body).not.toContain("Gerrin");
		expect(results[0].power).toBe(2);
	});
});

describe("applySpendIntent — scratch on unowned owners", () => {
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
		wireActors(hero, foe);
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
		wireActors(hero, foe);

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
		wireActors(foe);

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
		wireActors(foe);

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
		wireActors(foe);

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
