import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	narratorSeats,
	readRollSeat,
} from "../modules/apps/roll/roll-pipeline.js";
import {
	demoteRollDialogOnSeatTaken,
	guardFellowshipSeat,
} from "../modules/system/hooks/actor-hooks.js";

// Every player owns the Fellowship, so any of them can write its roll
// presence flag. A Narrator-called roll there (Acting Together) is always
// held by a Narrator. Whether a roll is a live call is read from what a
// Narrator last wrote (`narratorSeats`), never from the flag a player may
// just have rewritten.

const USERS = {
	gm: { id: "gm", isGM: true },
	player: { id: "player", isGM: false },
	other: { id: "other", isGM: false },
};

function actorWith(type, flag) {
	const actor = {
		id: `${type}-1`,
		type,
		flags: { litmv2: { rollDialogOwner: flag ?? undefined } },
		getFlag: (_scope, key) => actor.flags.litmv2[key],
		update: vi.fn(async () => {}),
	};
	return actor;
}

const called = (ownerId) => ({
	ownerId,
	narrator: true,
	syncSession: "call-1",
	call: { participantIds: ["h1", "h2"], narratorUserId: "gm" },
});

/** The flag a write leaves, and the hook call the server would cause. */
const writeTo = (handler) => (actor, flag, userId) => {
	actor.flags.litmv2.rollDialogOwner = flag ?? undefined;
	return handler(
		actor,
		{ flags: { litmv2: { rollDialogOwner: flag ?? null } } },
		{},
		userId,
	);
};
const handlerOf = (register) => {
	Hooks.on.mockClear();
	register();
	return Hooks.on.mock.calls.find(([name]) => name === "updateActor")[1];
};

beforeEach(() => {
	narratorSeats.clear();
	game.users.get.mockImplementation((id) => USERS[id]);
});
afterEach(() => {
	narratorSeats.clear();
	game.users.get.mockReset();
	game.users.activeGM = null;
});

describe("readRollSeat", () => {
	it("ignores a called Fellowship seat held by a player", () => {
		expect(readRollSeat(actorWith("fellowship", called("player")))).toBeNull();
	});

	it("keeps a called Fellowship seat held by the Narrator", () => {
		const flag = called("gm");
		expect(readRollSeat(actorWith("fellowship", flag))).toBe(flag);
	});

	it("keeps an ordinary Fellowship roll's seat, whoever holds it", () => {
		const flag = { ownerId: "player" };
		expect(readRollSeat(actorWith("fellowship", flag))).toBe(flag);
	});

	it("keeps a called Hero seat its player holds", () => {
		const flag = called("player");
		expect(readRollSeat(actorWith("hero", flag))).toBe(flag);
	});

	// A player clearing the `narrator` marker would otherwise pass the
	// flag's own check.
	it("gives a live call's Narrator seat, whatever a player rewrote", () => {
		const actor = actorWith("fellowship", {
			ownerId: "player",
			narrator: false,
		});
		narratorSeats.set(actor.id, called("gm"));
		expect(readRollSeat(actor)).toMatchObject({
			ownerId: "gm",
			narrator: true,
		});
	});
});

describe("guardFellowshipSeat", () => {
	let write;
	beforeEach(() => {
		write = writeTo(handlerOf(guardFellowshipSeat));
		game.users.activeGM = USERS.gm;
		game.user = USERS.gm;
	});
	const replaced = (actor) =>
		actor.update.mock.calls.at(-1)?.[0]?.["flags.litmv2.rollDialogOwner"];

	it("puts back the Narrator's call, in one write, when a player moves its seat", async () => {
		const actor = actorWith("fellowship");
		const call = called("gm");
		await write(actor, call, "gm");
		await write(actor, { ...call, ownerId: "player" }, "player");
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(replaced(actor)).toEqual({ forcedReplacement: call });
	});

	it("puts it back when a player rewrites it as an ordinary roll", async () => {
		const actor = actorWith("fellowship");
		const call = called("gm");
		await write(actor, call, "gm");
		await write(actor, { ownerId: "player", narrator: false }, "player");
		expect(replaced(actor)).toEqual({ forcedReplacement: call });
	});

	it("puts it back when a player ends the call", async () => {
		const actor = actorWith("fellowship");
		const call = called("gm");
		await write(actor, call, "gm");
		await write(actor, null, "player");
		expect(replaced(actor)).toEqual({ forcedReplacement: call });
	});

	it("keeps remembering the call through repeated forgeries", async () => {
		const actor = actorWith("fellowship");
		const call = called("gm");
		await write(actor, call, "gm");
		await write(actor, { ...call, ownerId: "player" }, "player");
		await write(actor, null, "player");
		await write(actor, { ownerId: "player" }, "player");
		expect(actor.update).toHaveBeenCalledTimes(3);
		for (const [changes] of actor.update.mock.calls)
			expect(changes["flags.litmv2.rollDialogOwner"]).toEqual({
				forcedReplacement: call,
			});
	});

	it("removes a call a player forged where there was none", async () => {
		const actor = actorWith("fellowship");
		await write(actor, called("gm"), "player");
		expect(replaced(actor)).toEqual({ forcedDeletion: true });
	});

	it("takes the Narrator's own writes as the call, ending included", async () => {
		const actor = actorWith("fellowship");
		await write(actor, called("gm"), "gm");
		await write(actor, null, "gm");
		expect(actor.update).not.toHaveBeenCalled();
		expect(narratorSeats.get(actor.id)).toBeNull();
		expect(readRollSeat(actor)).toBeNull();
	});

	it("leaves an ordinary Fellowship roll to whoever owns it", async () => {
		const actor = actorWith("fellowship");
		await write(actor, { ownerId: "player" }, "player");
		await write(actor, null, "player");
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("is repaired only by the active Narrator's client", async () => {
		game.user = USERS.player;
		const actor = actorWith("fellowship");
		await write(actor, called("gm"), "gm");
		await write(actor, { ...called("gm"), ownerId: "player" }, "player");
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("ignores a Hero's flag, which only its player and the Narrator write", async () => {
		const actor = actorWith("hero");
		await write(actor, called("player"), "player");
		expect(actor.update).not.toHaveBeenCalled();
	});
});

describe("the call's record where players can't write", () => {
	let savedSettings;
	beforeEach(() => {
		savedSettings = {};
		game.settings.get.mockImplementation((_scope, key) =>
			key === "fellowshipSeats" ? savedSettings : undefined,
		);
		game.settings.set.mockImplementation(async (_scope, key, value) => {
			if (key === "fellowshipSeats") savedSettings = value;
		});
		game.users.activeGM = USERS.gm;
	});
	afterEach(() => {
		game.settings.get.mockReset();
		game.settings.set.mockReset();
		delete game.actors.filter;
	});

	it("is written by the Narrator's own client when it writes the flag", async () => {
		game.user = USERS.gm;
		const write = writeTo(handlerOf(guardFellowshipSeat));
		const actor = actorWith("fellowship");
		await write(actor, called("gm"), "gm");
		expect(savedSettings[actor.id]).toMatchObject({
			ownerId: "gm",
			narrator: true,
		});
	});

	it("seeds a reloading client, and the Narrator puts a forgery back", () => {
		game.user = USERS.gm;
		Hooks.once.mockClear();
		guardFellowshipSeat();
		const ready = Hooks.once.mock.calls.find(([name]) => name === "ready")[1];
		// Rewritten while no Narrator was connected.
		const actor = actorWith("fellowship", {
			ownerId: "player",
			narrator: false,
		});
		savedSettings = { [actor.id]: called("gm") };
		game.actors.filter = (fn) => [actor].filter(fn);
		ready();
		expect(readRollSeat(actor)).toMatchObject({ ownerId: "gm" });
		expect(
			actor.update.mock.calls[0][0]["flags.litmv2.rollDialogOwner"],
		).toEqual({ forcedReplacement: called("gm") });
	});
});

describe("a module rewriting an Acting Together call", () => {
	it("cannot hand its seat to a player", async () => {
		const { openSharedRoll } = await import(
			"../modules/apps/roll/roll-request.js"
		);
		const { Sockets } = await import("../modules/system/sockets.js");
		const dispatch = vi.spyOn(Sockets, "dispatch").mockImplementation(() => {});
		game.user = { ...USERS.gm, name: "GM" };
		const actor = {
			...actorWith("fellowship"),
			setFlag: vi.fn(async () => {}),
		};
		game.actors.get.mockImplementation((id) =>
			id === actor.id ? actor : null,
		);
		const savedLitm = game.litmv2;
		game.litmv2 = { ...savedLitm, fellowship: actor };
		Hooks.call.mockImplementationOnce((_name, payload) => {
			payload.ownerId = "player";
			return true;
		});
		try {
			const payload = await openSharedRoll({ actorId: actor.id });
			expect(payload.ownerId).toBe("gm");
			expect(actor.setFlag.mock.calls[0][2]).toMatchObject({ ownerId: "gm" });
		} finally {
			dispatch.mockRestore();
			game.litmv2 = savedLitm;
			game.actors.get.mockReset();
		}
	});
});

describe("a call forged while no Narrator was connected", () => {
	afterEach(() => {
		game.settings.get.mockReset();
		delete game.actors.filter;
	});

	it("is removed when the Narrator's client loads", () => {
		game.user = USERS.gm;
		game.users.activeGM = USERS.gm;
		Hooks.once.mockClear();
		guardFellowshipSeat();
		const ready = Hooks.once.mock.calls.find(([name]) => name === "ready")[1];
		// No call was recorded (the last one ended); a player wrote one naming
		// the Narrator, with a title and participants of their choosing.
		const actor = actorWith("fellowship", called("gm"));
		game.settings.get.mockImplementation((_scope, key) =>
			key === "fellowshipSeats" ? { [actor.id]: null } : undefined,
		);
		game.actors.filter = (fn) => [actor].filter(fn);
		ready();
		expect(
			actor.update.mock.calls[0][0]["flags.litmv2.rollDialogOwner"],
		).toEqual({ forcedDeletion: true });
		expect(narratorSeats.get(actor.id)).toBeNull();
	});
});

describe("the HUD strip when a Fellowship call ends", () => {
	it("reads the ended call, not the memory of it", async () => {
		const { registerActorHooks } = await import(
			"../modules/system/hooks/actor-hooks.js"
		);
		Hooks.on.mockClear();
		registerActorHooks();
		const handlers = Hooks.on.mock.calls
			.filter(([name]) => name === "updateActor")
			.map(([, fn]) => fn);
		game.user = USERS.gm;
		game.users.activeGM = USERS.gm;
		const actor = actorWith("fellowship");
		const seen = [];
		game.litmv2 = {
			...game.litmv2,
			rollDialogHud: { render: () => seen.push(readRollSeat(actor)) },
		};
		const run = async (flag, userId) => {
			actor.flags.litmv2.rollDialogOwner = flag ?? undefined;
			const changes = { flags: { litmv2: { rollDialogOwner: flag ?? null } } };
			for (const fn of handlers) await fn(actor, changes, {}, userId);
		};
		await run(called("gm"), "gm");
		await run(null, "gm");
		expect(seen.at(-1)).toBeNull();
	});
});

describe("the seat-taken hook on a live Fellowship call", () => {
	it("does not move any window to a player who rewrote the seat", async () => {
		const guard = writeTo(handlerOf(guardFellowshipSeat));
		const follow = handlerOf(demoteRollDialogOnSeatTaken);
		game.user = USERS.other;
		const dialog = { followSeat: vi.fn(() => true), rendered: false };
		const actor = actorWith("fellowship");
		actor.sheet = { hasRollDialog: true, rollDialogInstance: dialog };
		await guard(actor, called("gm"), "gm");

		const forged = { ownerId: "player", narrator: false };
		actor.flags.litmv2.rollDialogOwner = forged;
		const changes = { flags: { litmv2: { rollDialogOwner: forged } } };
		await guard(actor, forged, "player");
		follow(actor, changes, {}, "player");

		expect(dialog.followSeat).not.toHaveBeenCalledWith("player");
	});
});
