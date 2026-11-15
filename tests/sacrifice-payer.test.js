import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	canSettleSacrifice,
	sacrificePayerId,
} from "../modules/apps/roll/sacrifice-price.js";

// sacrifice-price.js: "The one user who pays a Hero's debt: an active player
// owning the Hero, else the Narrator — the same seat a shared roll picks. One
// payer, so two owners can't both press Complete in the same moment and pay it
// twice; any Narrator may still forgive."

const user = (id, { active = true, isGM = false } = {}) => ({
	id,
	active,
	isGM,
});

let users;
const heroOwnedBy = (...ids) => ({
	id: "hero",
	testUserPermission: vi.fn(
		(u, level) => level === "OWNER" && ids.includes(u.id),
	),
});

beforeEach(() => {
	users = [];
	game.users.filter = (fn) => users.filter(fn);
	game.users.activeGM = null;
});
afterEach(() => {
	delete game.users.filter;
	game.users.activeGM = null;
});

describe("sacrificePayerId", () => {
	it("is the active player who owns the Hero", () => {
		users = [user("gm", { isGM: true }), user("alice")];
		game.users.activeGM = users[0];
		expect(sacrificePayerId(heroOwnedBy("alice"))).toBe("alice");
	});

	it("names one of the owners, not the Narrator, when two active players own the Hero", () => {
		users = [user("gm", { isGM: true }), user("alice"), user("bob")];
		game.users.activeGM = users[0];
		expect(["alice", "bob"]).toContain(
			sacrificePayerId(heroOwnedBy("alice", "bob")),
		);
	});

	it("skips an owner who is not connected and falls to the active Narrator", () => {
		users = [user("gm", { isGM: true }), user("alice", { active: false })];
		game.users.activeGM = users[0];
		expect(sacrificePayerId(heroOwnedBy("alice"))).toBe("gm");
	});

	it("takes a later active owner over an earlier inactive one", () => {
		users = [user("alice", { active: false }), user("bob")];
		expect(sacrificePayerId(heroOwnedBy("alice", "bob"))).toBe("bob");
	});

	it("is the active Narrator for a Hero nobody plays", () => {
		users = [user("gm", { isGM: true }), user("alice")];
		game.users.activeGM = users[0];
		expect(sacrificePayerId(heroOwnedBy())).toBe("gm");
	});

	it("does not count a Narrator's OWNER permission as a player seat", () => {
		// A GM has OWNER on every document; the fall-back, not the owner list,
		// decides which Narrator pays.
		users = [
			user("gm-1", { isGM: true }),
			user("gm-2", { isGM: true }),
			user("alice", { active: false }),
		];
		game.users.activeGM = users[1];
		expect(sacrificePayerId(heroOwnedBy("gm-1", "gm-2", "alice"))).toBe("gm-2");
	});

	it("is nobody when no player is connected and no Narrator is active", () => {
		users = [user("alice", { active: false })];
		expect(sacrificePayerId(heroOwnedBy("alice"))).toBeNull();
		expect(sacrificePayerId(heroOwnedBy())).toBeNull();
	});

	it("asks only for OWNER permission", () => {
		users = [user("alice")];
		const hero = heroOwnedBy("alice");
		sacrificePayerId(hero);
		expect(hero.testUserPermission).toHaveBeenCalledWith(users[0], "OWNER");
		expect(hero.testUserPermission).not.toHaveBeenCalledWith(
			users[0],
			"OBSERVER",
		);
	});
});

describe("canSettleSacrifice", () => {
	// "Whether `user` may open the payment dialog: the payer, or a Narrator to
	// forgive."
	beforeEach(() => {
		users = [user("gm", { isGM: true }), user("alice"), user("bob")];
		game.users.activeGM = users[0];
	});

	it("lets the payer open it", () => {
		expect(canSettleSacrifice(heroOwnedBy("alice", "bob"), users[1])).toBe(
			true,
		);
	});

	it("keeps the Hero's other owner out, so a price is not paid twice", () => {
		const hero = heroOwnedBy("alice", "bob");
		expect(sacrificePayerId(hero)).toBe("alice");
		expect(canSettleSacrifice(hero, users[2])).toBe(false);
	});

	it("lets any Narrator in, to forgive, payer or not", () => {
		expect(canSettleSacrifice(heroOwnedBy("alice"), users[0])).toBe(true);
		const other = user("gm-2", { isGM: true });
		expect(canSettleSacrifice(heroOwnedBy("alice"), other)).toBe(true);
	});

	it("keeps out a player who does not own the Hero", () => {
		expect(canSettleSacrifice(heroOwnedBy("alice"), users[2])).toBe(false);
	});

	it("is never true without a Hero", () => {
		expect(canSettleSacrifice(null, users[0])).toBe(false);
		expect(canSettleSacrifice(undefined, users[0])).toBe(false);
	});

	it("reads the current user when none is passed", () => {
		game.user = users[1];
		expect(canSettleSacrifice(heroOwnedBy("alice"))).toBe(true);
		game.user = users[2];
		expect(canSettleSacrifice(heroOwnedBy("alice"))).toBe(false);
	});
});
