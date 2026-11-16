import { beforeEach, describe, expect, it, vi } from "vitest";
import { gainImprovement } from "../modules/actor/hero/hero-data.js";
import { processPostRollEffects } from "../modules/apps/roll/roll-pipeline.js";
import { ContentSources } from "../modules/system/content-sources.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";
import { stubSettings } from "./__helpers__/settings.js";

// What a roll leaves behind on the roller's own Hero: the burned tag is
// scratched (one per roll, p.158), a single-use tag is used up, and an invoked
// weakness or relationship marks Improve. The relays for tags the roller can't
// write are in post-roll-scratch-relay.test.js.
vi.mock("../modules/system/sockets.js", () => ({
	Sockets: { dispatch: vi.fn() },
}));
vi.mock("../modules/actor/hero/hero-data.js", async (original) => ({
	...(await original()),
	gainImprovement: vi.fn(async () => null),
}));

/** An effect on the Hero that records what was written to it. */
const ownTag = (id, { type = "power_tag", system = {} } = {}) => {
	const effect = fakeEffect({ id, type, name: id });
	effect.system = {
		isScratched: false,
		setScratched: vi.fn(async (value) => {
			effect.system.isScratched = value;
		}),
		...system,
	};
	return effect;
};
/** The roll's record of a tag, as the dialog stores it. */
const rolled = (effect, extra = {}) => ({
	id: effect.id,
	uuid: effect.uuid,
	name: effect.name,
	type: effect.type,
	...extra,
});

let autoMarkImprove;
let res;
let roll;
const run = (
	actor,
	{ scratchedTags = [], powerTags = [], weaknessTags = [] },
) =>
	processPostRollEffects({
		actor,
		roll,
		res,
		scratchedTags,
		powerTags,
		weaknessTags,
	});

beforeEach(() => {
	vi.clearAllMocks();
	autoMarkImprove = true;
	stubSettings((key) =>
		key === "auto_mark_improve" ? autoMarkImprove : undefined,
	);
	game.user.isGM = false;
	game.users.activeGM = null;
	foundry.utils.fromUuidSync.mockReset();
	res = { update: vi.fn() };
	roll = { options: {}, toJSON: () => ({ options: roll.options }) };
});

describe("burning a tag", () => {
	it("scratches the burned tag on the roller's own Hero", async () => {
		const bow = ownTag("bow");
		await run(fakeActor({ effects: [bow] }), { scratchedTags: [rolled(bow)] });
		expect(bow.system.setScratched).toHaveBeenCalledWith(true);
		expect(bow.system.isScratched).toBe(true);
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("scratches a burned Fellowship tag through the Hero's Fellowship", async () => {
		const oath = ownTag("oath", { type: "fellowship_tag" });
		const fellowship = fakeActor({ type: "fellowship", effects: [oath] });
		const hero = fakeActor({ system: { fellowshipActor: fellowship } });
		await run(hero, { scratchedTags: [rolled(oath)] });
		expect(oath.system.isScratched).toBe(true);
	});

	it("scratches only the first when a roll carries two burns (p.158)", async () => {
		const bow = ownTag("bow");
		const axe = ownTag("axe");
		await run(fakeActor({ effects: [bow, axe] }), {
			scratchedTags: [rolled(bow), rolled(axe)],
		});
		expect(bow.system.isScratched).toBe(true);
		expect(axe.system.setScratched).not.toHaveBeenCalled();
	});

	it("leaves an invoked tag that was not burned alone", async () => {
		const bow = ownTag("bow");
		await run(fakeActor({ effects: [bow] }), { powerTags: [rolled(bow)] });
		expect(bow.system.setScratched).not.toHaveBeenCalled();
	});

	it("saves the roll with what it did, so the card does not offer it again", async () => {
		const bow = ownTag("bow");
		await run(fakeActor({ effects: [bow] }), { scratchedTags: [rolled(bow)] });
		expect(roll.options.isScratched).toBe(true);
		expect(res.update).toHaveBeenCalledWith({
			rolls: [{ options: expect.objectContaining({ isScratched: true }) }],
		});
	});

	it("does nothing for a roll with no actor behind it", async () => {
		const bow = ownTag("bow");
		await run(null, { scratchedTags: [rolled(bow)] });
		expect(bow.system.setScratched).not.toHaveBeenCalled();
		expect(roll.options.isScratched).toBeUndefined();
	});
});

describe("a single-use tag", () => {
	it("is used up when invoked for Power", async () => {
		const bond = ownTag("bond", {
			type: "fellowship_tag",
			system: { isSingleUse: true },
		});
		await run(fakeActor({ effects: [bond] }), {
			powerTags: [rolled(bond, { system: { isSingleUse: true } })],
		});
		expect(bond.system.isScratched).toBe(true);
	});

	it("is used up when invoked against the roll", async () => {
		const rope = ownTag("rope", { type: "story_tag" });
		await run(fakeActor({ effects: [rope] }), {
			weaknessTags: [rolled(rope, { system: { isSingleUse: true } })],
		});
		expect(rope.system.isScratched).toBe(true);
	});

	// A moderation card's flags drop the data model's getters; the plain
	// field the dialog stores beside them carries the answer.
	it("is still used up after the moderation round trip", async () => {
		const bond = ownTag("bond", { type: "relationship_tag" });
		const tag = JSON.parse(
			JSON.stringify(rolled(bond, { isSingleUse: true, system: {} })),
		);
		await run(fakeActor({ effects: [bond] }), { powerTags: [tag] });
		expect(bond.system.isScratched).toBe(true);
	});

	it("is the only kind of invoked tag the roll scratches", async () => {
		const bow = ownTag("bow");
		const bond = ownTag("bond");
		await run(fakeActor({ effects: [bow, bond] }), {
			powerTags: [
				rolled(bow, { system: { isSingleUse: false } }),
				rolled(bond, { system: { isSingleUse: true } }),
			],
		});
		expect(bow.system.setScratched).not.toHaveBeenCalled();
		expect(bond.system.isScratched).toBe(true);
	});
});

describe("a scene tag the Narrator burns", () => {
	const sceneTag = {
		id: "s1",
		_id: "s1",
		uuid: "Compendium.world.tags.ActiveEffect.s1",
		name: "fog",
		type: "story_tag",
	};

	it("is scratched in the story-tag pack by the Narrator's own client", async () => {
		game.user.isGM = true;
		const update = vi
			.spyOn(ContentSources, "updateStoryTags")
			.mockResolvedValue(undefined);
		await run(fakeActor(), { scratchedTags: [sceneTag] });
		expect(update).toHaveBeenCalledWith([
			{ _id: "s1", "system.isScratched": true },
		]);
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("goes to the active Narrator when a player burned it", async () => {
		game.users.activeGM = { id: "gm" };
		const update = vi.spyOn(ContentSources, "updateStoryTags");
		await run(fakeActor(), { scratchedTags: [sceneTag] });
		expect(update).not.toHaveBeenCalled();
		expect(Sockets.dispatch).toHaveBeenCalledWith("storyTagsUpdate", {
			operation: "updateTags",
			data: [{ _id: "s1", "system.isScratched": true }],
		});
	});
});

describe("marking Improve", () => {
	const weakness = { id: "w", uuid: "Effect.w", type: "weakness_tag" };
	const relationship = { id: "r", uuid: "Effect.r", type: "relationship_tag" };
	// A scene tag or status invoked against the roll is no weakness.
	const negativeStory = { id: "n", uuid: "Effect.n", type: "story_tag" };

	it("marks once for each weakness or relationship tag invoked, and for nothing else", async () => {
		const actor = fakeActor();
		await run(actor, {
			weaknessTags: [weakness, negativeStory, relationship],
		});
		expect(gainImprovement.mock.calls).toEqual([
			[actor, weakness],
			[actor, relationship],
		]);
	});

	it("does not mark for a power tag", async () => {
		await run(fakeActor(), {
			powerTags: [{ id: "p", uuid: "Effect.p", type: "power_tag" }],
		});
		expect(gainImprovement).not.toHaveBeenCalled();
	});

	it("latches the roll as marked and saves it", async () => {
		await run(fakeActor(), { weaknessTags: [weakness] });
		expect(roll.options.gainedExp).toBe(true);
		expect(res.update).toHaveBeenCalledWith({
			rolls: [{ options: expect.objectContaining({ gainedExp: true }) }],
		});
	});

	it("leaves it to the card's button when the table marks Improve by hand", async () => {
		autoMarkImprove = false;
		await run(fakeActor(), { weaknessTags: [weakness] });
		expect(gainImprovement).not.toHaveBeenCalled();
		// Not latched: the card's "Mark Improve" button reads this.
		expect(roll.options.gainedExp).toBe(false);
		expect(res.update).not.toHaveBeenCalled();
	});

	it("does not rewrite the card for a roll that burned and marked nothing", async () => {
		await run(fakeActor(), {
			powerTags: [{ id: "p", uuid: "Effect.p", type: "power_tag" }],
		});
		expect(res.update).not.toHaveBeenCalled();
	});
});
