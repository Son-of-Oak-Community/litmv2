import { beforeEach, describe, expect, it, vi } from "vitest";
import { processPostRollEffects } from "../modules/apps/roll/roll-pipeline.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor, fakeEffect } from "./__helpers__/factories.js";

// A burned ally or scene tag the roller can't write goes to the active GM.
// With no GM online that request reached nobody and the tag silently stayed
// unscratched; the roller is now told instead.
vi.mock("../modules/system/sockets.js", () => ({
	Sockets: { dispatch: vi.fn() },
}));

function run(tag) {
	return processPostRollEffects({
		actor: fakeActor({ type: "hero" }),
		roll: { options: {}, toJSON: () => ({}) },
		res: { update: vi.fn() },
		scratchedTags: [tag],
		powerTags: [],
		weaknessTags: [],
	});
}

const allyTag = () => {
	const effect = fakeEffect({ type: "power_tag", name: "rope" });
	effect.isOwner = false;
	foundry.utils.fromUuidSync.mockReturnValue(effect);
	return { id: "not-mine", uuid: effect.uuid, name: "rope", type: "power_tag" };
};
const sceneTag = { id: "s1", _id: "s1", uuid: "Compendium.world.tags.ActiveEffect.s1", name: "fog", type: "story_tag" };

beforeEach(() => {
	vi.clearAllMocks();
	game.users.activeGM = null;
	game.user.isGM = false;
	game.settings.get = vi.fn(() => false);
});

describe("post-roll scratch relay", () => {
	it("relays an ally tag to the active GM", async () => {
		game.users.activeGM = { id: "gm" };
		const tag = allyTag();
		await run(tag);
		expect(Sockets.dispatch).toHaveBeenCalledWith("scratchEffect", { uuid: tag.uuid });
	});

	it("warns instead of dropping an ally tag when no GM is online", async () => {
		await run(allyTag());
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(ui.notifications.warn).toHaveBeenCalled();
	});

	it("warns instead of dropping a scene tag when no GM is online", async () => {
		await run(sceneTag);
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(ui.notifications.warn).toHaveBeenCalled();
	});
});
