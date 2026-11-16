import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	narratorSeats,
	resolveRollDialogOwnership,
} from "../modules/apps/roll/roll-pipeline.js";

// Who holds a roll when a client opens its window: the seat the presence flag
// names, unless nobody is in it. A Narrator steps aside for a player who is
// rolling their own Hero, and takes the seat back when that player is gone.

const USERS = {
	gm: { id: "gm", isGM: true, active: true },
	gm2: { id: "gm2", isGM: true, active: true },
	player: { id: "player", isGM: false, active: true },
	other: { id: "other", isGM: false, active: true },
};

let savedUsers;
let users;
const as = (id) => {
	game.user = users[id];
};
/** A Hero owned by `owners`, with `flag` as its roll presence flag. */
const hero = (owners, flag = null, type = "hero") => ({
	id: "actor",
	type,
	getFlag: (_scope, key) => (key === "rollDialogOwner" ? flag : undefined),
	testUserPermission: (user, level) =>
		level === "OWNER" && (user.isGM || owners.includes(user.id)),
});
const resolve = (actor, userId) => {
	as(userId);
	return resolveRollDialogOwnership(actor, userId);
};

beforeEach(() => {
	savedUsers = game.users;
	users = structuredClone(USERS);
	game.users = {
		get: (id) => users[id],
		some: (fn) => Object.values(users).some(fn),
	};
	narratorSeats.clear();
});
afterEach(() => {
	game.users = savedUsers;
	narratorSeats.clear();
});

describe("resolveRollDialogOwnership", () => {
	describe("a roll nobody holds yet", () => {
		it("goes to the Hero's player who opens it", () => {
			expect(resolve(hero(["player"]), "player")).toEqual({
				isOwner: true,
				gmAsViewer: false,
				activeOwnerId: null,
			});
		});

		it("goes to the Narrator who opens it", () => {
			expect(resolve(hero(["player"]), "gm")).toMatchObject({
				isOwner: true,
				gmAsViewer: false,
			});
		});

		it("is only watched by a player who does not own the Hero", () => {
			expect(resolve(hero(["player"]), "other")).toMatchObject({
				isOwner: false,
				gmAsViewer: false,
			});
		});
	});

	describe("a roll its player holds", () => {
		const held = () => hero(["player"], { ownerId: "player" });

		it("stays with the player on their own client", () => {
			expect(resolve(held(), "player")).toEqual({
				isOwner: true,
				gmAsViewer: false,
				activeOwnerId: "player",
			});
		});

		it("is watched by the Narrator, who does not take it", () => {
			expect(resolve(held(), "gm")).toEqual({
				isOwner: false,
				gmAsViewer: true,
				activeOwnerId: "player",
			});
		});

		it("is watched by another player", () => {
			expect(resolve(held(), "other")).toMatchObject({
				isOwner: false,
				gmAsViewer: false,
			});
		});

		it("is taken up by the Narrator once the player has gone", () => {
			users.player.active = false;
			expect(resolve(held(), "gm")).toMatchObject({
				isOwner: true,
				gmAsViewer: false,
			});
		});

		it("is taken up by a second owner once the player has gone", () => {
			users.player.active = false;
			const shared = hero(["player", "other"], { ownerId: "player" });
			expect(resolve(shared, "other").isOwner).toBe(true);
		});

		it("is not taken up by a player who does not own the Hero, even then", () => {
			users.player.active = false;
			expect(resolve(held(), "other").isOwner).toBe(false);
		});

		it("is taken up when the user the flag names no longer exists", () => {
			const stale = hero(["player"], { ownerId: "deleted-user" });
			expect(resolve(stale, "player").isOwner).toBe(true);
		});
	});

	describe("a roll the Narrator holds", () => {
		const held = () => hero(["player"], { ownerId: "gm" });

		it("stays with the Narrator on their own client", () => {
			expect(resolve(held(), "gm")).toMatchObject({
				isOwner: true,
				gmAsViewer: false,
			});
		});

		it("is the Hero's player's to take over", () => {
			expect(resolve(held(), "player")).toEqual({
				isOwner: true,
				gmAsViewer: false,
				activeOwnerId: "gm",
			});
		});

		it("is another Narrator's to take over", () => {
			expect(resolve(held(), "gm2").isOwner).toBe(true);
		});

		it("is only watched by a player who does not own the Hero", () => {
			expect(resolve(held(), "other").isOwner).toBe(false);
		});
	});

	it("leaves a Hero nobody plays with the Narrator, never as a viewer", () => {
		const npc = hero([], { ownerId: "gm" });
		expect(resolve(npc, "gm")).toMatchObject({
			isOwner: true,
			gmAsViewer: false,
		});
	});

	// The Narrator steps aside for a player rolling their own Hero, not for
	// a stale seat on a Hero no player owns.
	it("does not make the Narrator a viewer of a Hero no player owns", () => {
		const npc = hero([], { ownerId: "other" });
		expect(resolve(npc, "gm").gmAsViewer).toBe(false);
	});

	// Every player owns the Fellowship; a called roll's seat there is read as
	// a Narrator last wrote it (`readRollSeat`), not from the flag.
	it("reads an Acting Together seat through the Narrator's record of it", () => {
		const fellowship = hero(
			["player", "other"],
			{ ownerId: "player", narrator: false },
			"fellowship",
		);
		narratorSeats.set("actor", { ownerId: "gm", narrator: true });
		expect(resolve(fellowship, "gm")).toEqual({
			isOwner: true,
			gmAsViewer: false,
			activeOwnerId: "gm",
		});
	});
});
