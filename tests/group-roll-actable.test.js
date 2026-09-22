import { afterEach, describe, expect, it } from "vitest";
import { actableActorIds } from "../modules/apps/roll/roll-dialog-context.js";

/**
 * Acting Together, Core Book p.157: "Any or all of the Fellowship theme power
 * tags may be invoked as well, if they are relevant."
 *
 * `actableActorIds` answers "whose tags may this client move in this roll".
 * It gates three surfaces at once — whether a tab renders in full, whether a
 * row is locked, and whether a change is accepted — so the Fellowship being
 * missing from it hid the Fellowship tab outright for every participant.
 */

const FELLOWSHIP = "fellowship-1";

/**
 * A dialog stand-in plus the `game.actors` lookup the helper walks. No
 * `isGroupRoll` on it deliberately: the helper never reads one, because every
 * call site is already inside a group-roll branch.
 */
const makeDialog = ({ participantIds = [], owned = [] } = {}) => {
	game.actors.get = (id) => ({
		id,
		testUserPermission: () => owned.includes(id),
	});
	return { actorId: FELLOWSHIP, participantIds };
};

afterEach(() => {
	game.actors.get = () => null;
});

describe("actableActorIds", () => {
	it("gives a participant their own Hero", () => {
		const dialog = makeDialog({
			participantIds: ["h1", "h2"],
			owned: ["h1"],
		});
		expect(actableActorIds(dialog).has("h1")).toBe(true);
	});

	it("withholds another player's Hero", () => {
		const dialog = makeDialog({
			participantIds: ["h1", "h2"],
			owned: ["h1"],
		});
		expect(actableActorIds(dialog).has("h2")).toBe(false);
	});

	it("gives a participant the Fellowship — any or all of its tags may be invoked", () => {
		const dialog = makeDialog({
			participantIds: ["h1", "h2"],
			owned: ["h1"],
		});
		expect(actableActorIds(dialog).has(FELLOWSHIP)).toBe(true);
	});

	it("withholds the Fellowship from a spectator with no Hero in the roll", () => {
		const dialog = makeDialog({
			participantIds: ["h1", "h2"],
			owned: ["h9"],
		});
		expect(actableActorIds(dialog)).toEqual(new Set());
	});
});
