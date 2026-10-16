import { beforeEach, describe, expect, it, vi } from "vitest";
import { gainImprovement } from "../modules/actor/hero/hero-data.js";
import { Sockets } from "../modules/system/sockets.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

// A contributed weakness lives on another player's Hero, so the roller may not
// own the theme its Improve marks. That write must go through the active GM,
// never straight to a document the client can't update.
vi.mock("../modules/system/sockets.js", () => ({
	Sockets: { dispatch: vi.fn() },
}));

function contributedWeakness({ isOwner }) {
	const owner = fakeActor({ type: "hero" });
	const theme = fakeItem({ type: "theme", parent: owner });
	theme.isOwner = isOwner;
	theme.system = { improve: { value: 1 } };
	const effect = fakeEffect({ type: "weakness_tag", parent: theme });
	foundry.utils.fromUuid.mockResolvedValue(effect);
	const tag = { type: "weakness_tag", uuid: effect.uuid, name: "slow" };
	return { owner, theme, tag };
}

beforeEach(() => {
	vi.clearAllMocks();
	game.users.activeGM = null;
});

describe("gainImprovement ownership", () => {
	it("marks the theme directly when this client owns it", async () => {
		const roller = fakeActor({ type: "hero" });
		const { theme, tag } = contributedWeakness({ isOwner: true });

		await gainImprovement(roller, tag);

		expect(theme.update).toHaveBeenCalledWith({ "system.improve.value": 2 });
		expect(Sockets.dispatch).not.toHaveBeenCalled();
	});

	it("relays to the active GM when the theme belongs to someone else", async () => {
		game.users.activeGM = { id: "gm" };
		const roller = fakeActor({ type: "hero" });
		const { theme, tag } = contributedWeakness({ isOwner: false });

		const result = await gainImprovement(roller, tag);

		expect(result).toBeNull();
		expect(theme.update).not.toHaveBeenCalled();
		expect(Sockets.dispatch).toHaveBeenCalledWith("gainImprovement", {
			actorId: roller.id,
			tag: { type: "weakness_tag", uuid: tag.uuid },
		});
	});

	it("warns instead of writing when no GM is online", async () => {
		const roller = fakeActor({ type: "hero" });
		const { theme, tag } = contributedWeakness({ isOwner: false });

		const result = await gainImprovement(roller, tag);

		expect(result).toBeNull();
		expect(theme.update).not.toHaveBeenCalled();
		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(ui.notifications.warn).toHaveBeenCalled();
	});
});
