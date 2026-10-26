import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerActorHooks } from "../modules/system/hooks/actor-hooks.js";
import { fakeActor } from "./__helpers__/factories.js";

// createActor fires on every connected client. Scaffolding (default themes,
// backpack, story theme item) must run once, or a table with two GMs online
// gets every new actor's items twice.

const otherGM = { id: "user-other-gm", isGM: true };

const fireCreateActor = async (actor) => {
	const handlers = Hooks.on.mock.calls
		.filter(([hook]) => hook === "createActor")
		.map(([, fn]) => fn);
	for (const fn of handlers) fn(actor, {}, "user-player");
	// The scaffolding handler runs an un-awaited async IIFE.
	await new Promise((resolve) => setTimeout(resolve, 0));
};

const storyThemeActor = () => {
	const actor = fakeActor({ type: "story_theme" });
	actor.createEmbeddedDocuments = vi.fn().mockResolvedValue([]);
	return actor;
};

describe("createActor scaffolding", () => {
	const saved = {};

	beforeEach(() => {
		saved.user = game.user;
		saved.activeGM = game.users.activeGM;
		Hooks.on.mockClear();
		game.user = { id: "user-gm", isGM: true };
		registerActorHooks();
	});

	afterEach(() => {
		game.user = saved.user;
		game.users.activeGM = saved.activeGM;
		vi.unstubAllGlobals();
	});

	it("runs on the active GM", async () => {
		game.users.activeGM = game.user;
		const actor = storyThemeActor();
		await fireCreateActor(actor);
		expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
	});

	it("does nothing on a second GM who is not the active GM", async () => {
		game.users.activeGM = otherGM;
		const actor = storyThemeActor();
		await fireCreateActor(actor);
		expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("gives a new Hero's default themes increasing sort values", async () => {
		vi.stubGlobal("CONST", { SORT_INTEGER_DENSITY: 100000 });
		game.users.activeGM = game.user;
		const actor = fakeActor({ type: "hero" });
		await fireCreateActor(actor);
		const [, themes] = actor.createEmbeddedDocuments.mock.calls[0];
		expect(themes.map((it) => it.sort)).toEqual([
			100000, 200000, 300000, 400000,
		]);
	});
});
