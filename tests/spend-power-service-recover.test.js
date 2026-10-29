import { beforeEach, describe, expect, it, vi } from "vitest";
import { applySpendIntent } from "../modules/apps/spend-power-service.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";

// The Recover list is HeroData#scratchedTags, which includes the Fellowship's
// scratched tags — an actor the player usually does not own. Recovering one
// must resolve there, route its write through the active GM when the player
// can't make it, and bill Power only for tags that actually came back.
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

function recoverIntent(chips) {
	return {
		options: [
			{
				kind: "picker",
				optionId: "recover_tag",
				label: "LITM.Effects.recover.action",
				cost: 2,
				chips,
			},
		],
		messageId: null,
		alreadySpent: 0,
		targetActorId: null,
	};
}

/** A hero the player owns, linked to a Fellowship they do not own. */
function heroWithFellowship({ fellowshipOwned = false } = {}) {
	const heroTag = fakeEffect({
		id: "ht1",
		name: "rope",
		type: "story_tag",
		system: { isScratched: true },
	});
	const fellowshipTag = fakeEffect({
		id: "ft1",
		name: "shared campfire",
		type: "fellowship_tag",
		system: { isScratched: true },
	});
	const fellowship = fakeActor({
		id: "f1",
		name: "Fellowship",
		type: "fellowship",
		effects: [fellowshipTag],
		isOwner: fellowshipOwned,
	});
	const hero = fakeActor({
		id: "h1",
		name: "Gerrin",
		effects: [heroTag],
		system: { fellowshipActor: fellowship },
	});
	game.actors.get = vi.fn((id) => ({ h1: hero, f1: fellowship })[id] ?? null);
	return { hero, fellowship, heroTag, fellowshipTag };
}

describe("applySpendIntent — recover picker", () => {
	it("recovers the hero's own tag directly and charges 2", async () => {
		const { hero, heroTag } = heroWithFellowship();
		heroTag.isOwner = true;

		const { results, totalSpent } = await applySpendIntent(
			hero,
			recoverIntent([{ tagId: "ht1", tagName: "rope" }]),
		);

		expect(heroTag.update).toHaveBeenCalledWith({
			"system.isScratched": false,
		});
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(results[0]).toMatchObject({
			kind: "picker",
			power: 2,
			tags: [{ name: "rope", type: "story_tag", isScratched: false }],
		});
		expect(totalSpent).toBe(2);
	});

	it("resolves a scratched Fellowship tag and relays the recover to the active GM", async () => {
		const { hero, fellowshipTag } = heroWithFellowship();
		fellowshipTag.isOwner = false;
		game.users.activeGM = { id: "gm-1" };

		const { results, totalSpent } = await applySpendIntent(
			hero,
			recoverIntent([{ tagId: "ft1", tagName: "shared campfire" }]),
		);

		expect(fellowshipTag.update).not.toHaveBeenCalled();
		expect(Sockets.dispatch).toHaveBeenCalledWith("recoverEffect", {
			uuid: "Effect.ft1",
		});
		expect(results[0]).toMatchObject({
			kind: "picker",
			power: 2,
			tags: [
				{ name: "shared campfire", type: "fellowship_tag", isScratched: false },
			],
		});
		expect(totalSpent).toBe(2);
	});

	it("recovers a Fellowship tag directly when the player can write it", async () => {
		const { hero, fellowshipTag } = heroWithFellowship();
		fellowshipTag.isOwner = true;

		const { totalSpent } = await applySpendIntent(
			hero,
			recoverIntent([{ tagId: "ft1", tagName: "shared campfire" }]),
		);

		expect(fellowshipTag.update).toHaveBeenCalledWith({
			"system.isScratched": false,
		});
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(totalSpent).toBe(2);
	});

	it("recovers directly as the GM even without ownership", async () => {
		const { hero, fellowshipTag } = heroWithFellowship();
		fellowshipTag.isOwner = false;
		game.user.isGM = true;

		await applySpendIntent(
			hero,
			recoverIntent([{ tagId: "ft1", tagName: "shared campfire" }]),
		);

		expect(fellowshipTag.update).toHaveBeenCalledWith({
			"system.isScratched": false,
		});
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("skips and does not charge when the player can't write it and no GM is active", async () => {
		const { hero, fellowshipTag } = heroWithFellowship();
		fellowshipTag.isOwner = false;

		const { results, totalSpent } = await applySpendIntent(
			hero,
			recoverIntent([{ tagId: "ft1", tagName: "shared campfire" }]),
		);

		expect(fellowshipTag.update).not.toHaveBeenCalled();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(results[0]).toMatchObject({ kind: "picker", power: 0, tags: [] });
		expect(totalSpent).toBe(0);
	});

	it("skips a tag that cannot be resolved without charging for it", async () => {
		const { hero, heroTag } = heroWithFellowship();
		heroTag.isOwner = true;

		const { results, totalSpent } = await applySpendIntent(
			hero,
			recoverIntent([
				{ tagId: "gone", tagName: "ghost" },
				{ tagId: "ht1", tagName: "rope" },
			]),
		);

		expect(heroTag.update).toHaveBeenCalledTimes(1);
		expect(results[0]).toMatchObject({
			kind: "picker",
			power: 2,
			tags: [{ name: "rope", type: "story_tag", isScratched: false }],
		});
		expect(totalSpent).toBe(2);
	});
});
