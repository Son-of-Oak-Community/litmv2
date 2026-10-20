import { afterEach, describe, expect, it } from "vitest";
import { startsHiddenOn } from "../modules/active-effects/effect-queries.js";

// A hidden effect is hidden from the actor's owner too, so what the GM drops
// on a player's Hero must arrive visible, or the player never sees it.
describe("startsHiddenOn", () => {
	const original = game.user;
	afterEach(() => {
		game.user = original;
	});

	it("hides the GM's additions to an actor no player owns", () => {
		game.user = { isGM: true };
		expect(startsHiddenOn({ hasPlayerOwner: false })).toBe(true);
	});

	it("shows the GM's additions to a player-owned actor", () => {
		game.user = { isGM: true };
		expect(startsHiddenOn({ hasPlayerOwner: true })).toBe(false);
	});

	it("never hides a player's own additions", () => {
		game.user = { isGM: false };
		expect(startsHiddenOn({ hasPlayerOwner: false })).toBe(false);
	});
});
