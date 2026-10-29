import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateWorld } from "../modules/system/migrations.js";

// `ready` fires on every connected client. Pending world migrations delete and
// create effects, so with two GMs online both running 002/003 at once would
// either throw on the second delete or create a title tag twice — the very
// duplicate the migration exists to remove. Only the active GM runs them.
//
// A stored version of -1 takes the "first load — stamp" path, which touches
// the setting and nothing else, so a call to `settings.set` is the observable
// proof that this client ran the migration pass.

const otherGM = { id: "user-other-gm", isGM: true };

describe("migrateWorld", () => {
	const saved = {};

	beforeEach(() => {
		saved.user = game.user;
		saved.activeGM = game.users.activeGM;
		game.settings.get.mockReset().mockReturnValue(-1);
		game.settings.set.mockClear();
		game.user = { id: "user-gm", isGM: true };
	});

	afterEach(() => {
		game.user = saved.user;
		game.users.activeGM = saved.activeGM;
		game.settings.get.mockReset();
	});

	it("runs on the active GM", async () => {
		game.users.activeGM = game.user;
		await migrateWorld();
		expect(game.settings.set).toHaveBeenCalledTimes(1);
	});

	it("runs on any GM when Foundry reports no active GM", async () => {
		game.users.activeGM = null;
		await migrateWorld();
		expect(game.settings.set).toHaveBeenCalledTimes(1);
	});

	it("does nothing on a second GM who is not the active GM", async () => {
		game.users.activeGM = otherGM;
		await migrateWorld();
		expect(game.settings.set).not.toHaveBeenCalled();
	});

	it("does nothing on a non-GM", async () => {
		game.user = { id: "user-player", isGM: false };
		game.users.activeGM = null;
		await migrateWorld();
		expect(game.settings.set).not.toHaveBeenCalled();
	});
});
