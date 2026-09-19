import { afterEach, describe, expect, it } from "vitest";
import {
	buildRosterEntry,
	rosterName,
	rosterPortrait,
	rosterPresence,
} from "../modules/apps/roster.js";

/**
 * The roster row is the system's one character-selection control, so the two
 * things every surface used to disagree about — how a portrait resolves and
 * whether a name is masked — are pinned here rather than in each consumer.
 */

const originalUsers = globalThis.game.users;

function withUsers(users) {
	globalThis.game.users = {
		...originalUsers,
		filter: (fn) => users.filter(fn),
	};
}

function actor({ id = "a1", name = "Rill", img, token, masked } = {}) {
	return {
		id,
		name,
		img,
		prototypeToken: token ? { texture: { src: token } } : undefined,
		system: masked === undefined ? {} : { maskedName: masked },
		testUserPermission: () => false,
	};
}

afterEach(() => {
	globalThis.game.users = originalUsers;
	CONFIG.litmv2.assets = undefined;
});

describe("rosterPortrait", () => {
	it("prefers the prototype token texture", () => {
		expect(rosterPortrait(actor({ token: "tok.webp", img: "img.webp" }))).toBe(
			"tok.webp",
		);
	});

	it("falls back to the actor image", () => {
		expect(rosterPortrait(actor({ img: "img.webp" }))).toBe("img.webp");
	});

	it("falls back again to the configured default, so a row never collapses", () => {
		CONFIG.litmv2.assets = { icons: { defaultActor: "mystery.svg" } };
		expect(rosterPortrait(actor({}))).toBe("mystery.svg");
	});
});

describe("rosterName", () => {
	it("wears the mask when the actor has one", () => {
		expect(rosterName(actor({ name: "Gravebore", masked: "???" }))).toBe("???");
	});

	it("uses the plain name otherwise", () => {
		expect(rosterName(actor({ name: "Rill" }))).toBe("Rill");
	});

	it("prefers an empty mask over the real name, since an empty mask is still a mask", () => {
		expect(rosterName(actor({ name: "Gravebore", masked: "" }))).toBe("");
	});
});

describe("rosterPresence", () => {
	it("names the connected players", () => {
		withUsers([{ isGM: false, active: true, name: "Filip" }]);
		const a = actor({});
		a.testUserPermission = () => true;
		expect(rosterPresence(a)).toMatchObject({ meta: "Filip", online: true });
	});

	it("reports an owned but absent player as not connected", () => {
		withUsers([{ isGM: false, active: false, name: "Filip" }]);
		const a = actor({});
		a.testUserPermission = () => true;
		expect(rosterPresence(a)).toMatchObject({
			meta: "LITM.Ui.roster_away",
			online: false,
			unowned: false,
		});
	});

	it("reports an unowned character as having no player", () => {
		withUsers([{ isGM: false, active: true, name: "Filip" }]);
		expect(rosterPresence(actor({}))).toMatchObject({
			meta: "LITM.Ui.roster_no_player",
			online: false,
			unowned: true,
		});
	});

	it("does not count the Gamemaster as a player, who owns every actor", () => {
		withUsers([{ isGM: true, active: true, name: "Narrator" }]);
		const a = actor({});
		a.testUserPermission = () => true;
		expect(rosterPresence(a)).toMatchObject({
			meta: "LITM.Ui.roster_no_player",
			unowned: true,
		});
	});
});

describe("buildRosterEntry", () => {
	it("takes the caller's context line when presence was not asked for", () => {
		const row = buildRosterEntry(actor({ name: "The Gate" }), {
			meta: "Barred (2/4)",
		});
		expect(row.muted).toBe(false);
		expect(row.meta).toBe("Barred (2/4)");
	});

	it("mutes a row only when presence was asked for and nobody is there", () => {
		withUsers([]);
		expect(buildRosterEntry(actor({}), { presence: true }).muted).toBe(true);
		// Same actor, presence not asked for: a Challenge must not read as an
		// absent Hero.
		expect(buildRosterEntry(actor({}), {}).muted).toBe(false);
	});

	it("defaults the radio value to the actor id and honours an override", () => {
		expect(buildRosterEntry(actor({ id: "h7" }), {}).value).toBe("h7");
		expect(buildRosterEntry(actor({ id: "h7" }), { value: 3 }).value).toBe(3);
	});

	it("takes portrait and name overrides for callers that resolved a better one", () => {
		const row = buildRosterEntry(actor({ img: "img.webp", name: "Rill" }), {
			img: "placed-token.webp",
			name: "Someone",
		});
		expect(row.img).toBe("placed-token.webp");
		expect(row.name).toBe("Someone");
	});

	it("is a radio unless the surface ticks several", () => {
		expect(buildRosterEntry(actor({}), {}).multi).toBe(false);
		expect(buildRosterEntry(actor({}), { multi: true }).multi).toBe(true);
	});
});
