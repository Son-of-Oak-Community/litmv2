import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerFellowshipHooks } from "../modules/system/hooks/fellowship-hooks.js";
import { setGM } from "./__helpers__/users.js";

// One Fellowship actor per world, its id in the `fellowshipId` setting. On
// ready the active Narrator's client makes sure it exists and links every
// Hero to it; after that a second one cannot be created, the one there
// cannot be deleted, and it is never a user's character.
// (fellowship-hooks.test.js covers which client does the ready work.)

const FELLOWSHIP_ID = "fellowship-1";

const settings = {};

/** The callback a hook was registered with, by hook name. */
const registered = (mock, name) =>
	mock.mock.calls.find(([hook]) => hook === name)?.[1];

const fellowship = (id) => ({ id, type: "fellowship" });
const hero = (id, fellowshipId) => ({
	id,
	type: "hero",
	system: { fellowshipId },
});

/** Stand in for the world's actors collection. */
const worldActors = (actors) => {
	game.actors = {
		get: vi.fn((id) => actors.find((a) => a.id === id)),
		find: vi.fn((fn) => actors.find(fn)),
		filter: vi.fn((fn) => actors.filter(fn)),
	};
};

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(settings)) delete settings[key];
	Object.assign(settings, { use_fellowship: true, fellowshipId: "" });

	game.settings.get.mockImplementation((_ns, key) => settings[key]);
	game.settings.set.mockImplementation(async (_ns, key, value) => {
		settings[key] = value;
	});

	setGM("gm-1");
	game.users.activeGM = game.user;
	worldActors([]);

	foundry.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
	foundry.documents.Actor.create = vi.fn(async (data) => ({
		id: FELLOWSHIP_ID,
		...data,
	}));
	foundry.documents.Actor.updateDocuments = vi.fn(async () => []);
});

describe("ready: finding or making the Fellowship", () => {
	const runReady = async () => {
		registerFellowshipHooks();
		await registered(Hooks.once, "ready")();
	};

	it("keeps a stored id that still names a Fellowship", async () => {
		settings.fellowshipId = FELLOWSHIP_ID;
		worldActors([fellowship(FELLOWSHIP_ID)]);

		await runReady();

		expect(foundry.documents.Actor.create).not.toHaveBeenCalled();
		expect(game.settings.set).not.toHaveBeenCalled();
	});

	it("adopts a Fellowship the world already has when none is stored", async () => {
		worldActors([hero("h1", ""), fellowship("found-1")]);

		await runReady();

		expect(foundry.documents.Actor.create).not.toHaveBeenCalled();
		expect(settings.fellowshipId).toBe("found-1");
	});

	it("adopts one when the stored id names an actor that is gone", async () => {
		settings.fellowshipId = "deleted";
		worldActors([fellowship("found-1")]);

		await runReady();

		expect(foundry.documents.Actor.create).not.toHaveBeenCalled();
		expect(settings.fellowshipId).toBe("found-1");
	});

	it("does not take a stored id that names another kind of actor", async () => {
		settings.fellowshipId = "h1";
		worldActors([hero("h1", "")]);

		await runReady();

		expect(foundry.documents.Actor.create).toHaveBeenCalledTimes(1);
		expect(settings.fellowshipId).toBe(FELLOWSHIP_ID);
	});

	// Every player owns the Fellowship; the option lets this one create past
	// the duplicate guard below.
	it("creates it owned by everyone, past its own duplicate guard", async () => {
		await runReady();

		expect(foundry.documents.Actor.create).toHaveBeenCalledWith(
			{
				name: "LITM.Terms.fellowship",
				type: "fellowship",
				ownership: { default: 3 },
			},
			{ litm: { skipSingletonCheck: true } },
		);
	});
});

describe("ready: linking the Heroes", () => {
	const runReady = async () => {
		registerFellowshipHooks();
		await registered(Hooks.once, "ready")();
	};

	it("links every Hero that is not linked to it, in one write", async () => {
		settings.fellowshipId = FELLOWSHIP_ID;
		worldActors([
			fellowship(FELLOWSHIP_ID),
			hero("unlinked", ""),
			hero("stale", "old-fellowship"),
			hero("linked", FELLOWSHIP_ID),
			{ id: "c1", type: "challenge", system: {} },
		]);

		await runReady();

		expect(foundry.documents.Actor.updateDocuments).toHaveBeenCalledTimes(1);
		expect(foundry.documents.Actor.updateDocuments).toHaveBeenCalledWith([
			{ _id: "unlinked", "system.fellowshipId": FELLOWSHIP_ID },
			{ _id: "stale", "system.fellowshipId": FELLOWSHIP_ID },
		]);
	});

	it("links them to a Fellowship it has just created", async () => {
		worldActors([hero("h1", "")]);

		await runReady();

		expect(foundry.documents.Actor.updateDocuments).toHaveBeenCalledWith([
			{ _id: "h1", "system.fellowshipId": FELLOWSHIP_ID },
		]);
	});

	it("links them to a Fellowship it adopted", async () => {
		worldActors([hero("h1", ""), fellowship("found-1")]);

		await runReady();

		expect(foundry.documents.Actor.updateDocuments).toHaveBeenCalledWith([
			{ _id: "h1", "system.fellowshipId": "found-1" },
		]);
	});

	it("writes nothing when every Hero is already linked", async () => {
		settings.fellowshipId = FELLOWSHIP_ID;
		worldActors([fellowship(FELLOWSHIP_ID), hero("linked", FELLOWSHIP_ID)]);

		await runReady();

		expect(foundry.documents.Actor.updateDocuments).not.toHaveBeenCalled();
	});
});

describe("the Fellowship is a singleton", () => {
	const hook = (name) => {
		registerFellowshipHooks();
		return registered(Hooks.on, name);
	};
	const theFellowship = fellowship(FELLOWSHIP_ID);

	beforeEach(() => {
		settings.fellowshipId = FELLOWSHIP_ID;
		worldActors([theFellowship]);
	});

	describe("creating a second one", () => {
		it("is refused, with a warning", () => {
			const result = hook("preCreateActor")({ type: "fellowship" }, {}, {});

			expect(result).toBe(false);
			expect(ui.notifications.warn).toHaveBeenCalledWith(
				"LITM.Ui.warn_fellowship_singleton",
			);
		});

		it("is allowed for the system's own create", () => {
			const result = hook("preCreateActor")(
				{ type: "fellowship" },
				{},
				{ litm: { skipSingletonCheck: true } },
			);

			expect(result).toBeUndefined();
			expect(ui.notifications.warn).not.toHaveBeenCalled();
		});

		it("is allowed when the stored Fellowship no longer exists", () => {
			worldActors([]);

			expect(
				hook("preCreateActor")({ type: "fellowship" }, {}, {}),
			).toBeUndefined();
		});

		it("is allowed when no Fellowship is stored", () => {
			settings.fellowshipId = "";

			expect(
				hook("preCreateActor")({ type: "fellowship" }, {}, {}),
			).toBeUndefined();
		});

		it("leaves other actor types alone", () => {
			expect(hook("preCreateActor")({ type: "hero" }, {}, {})).toBeUndefined();
			expect(ui.notifications.warn).not.toHaveBeenCalled();
		});
	});

	describe("deleting it", () => {
		it("is refused, with a warning", () => {
			const result = hook("preDeleteActor")(theFellowship, {});

			expect(result).toBe(false);
			expect(ui.notifications.warn).toHaveBeenCalledWith(
				"LITM.Ui.warn_fellowship_no_delete",
			);
		});

		it("is allowed when forced", () => {
			expect(
				hook("preDeleteActor")(theFellowship, { litm: { forceDelete: true } }),
			).toBeUndefined();
		});

		it("is allowed for a Fellowship that is not the singleton", () => {
			expect(hook("preDeleteActor")(fellowship("stray"), {})).toBeUndefined();
		});

		it("leaves other actor types alone, even one with the stored id", () => {
			expect(
				hook("preDeleteActor")({ id: FELLOWSHIP_ID, type: "hero" }, {}),
			).toBeUndefined();
		});
	});

	describe("as a user's character", () => {
		it("is refused, with a warning", () => {
			const result = hook("preUpdateUser")({}, { character: FELLOWSHIP_ID });

			expect(result).toBe(false);
			expect(ui.notifications.warn).toHaveBeenCalledWith(
				"LITM.Ui.warn_fellowship_not_character",
			);
		});

		it("leaves any other character, and any other change, alone", () => {
			const preUpdateUser = hook("preUpdateUser");

			expect(preUpdateUser({}, { character: "hero-1" })).toBeUndefined();
			expect(preUpdateUser({}, { character: null })).toBeUndefined();
			expect(preUpdateUser({}, { name: "Ada" })).toBeUndefined();
		});
	});
});

describe("with the Fellowship turned off", () => {
	it("registers no hooks at all", () => {
		settings.use_fellowship = false;

		registerFellowshipHooks();

		expect(Hooks.on).not.toHaveBeenCalled();
		expect(Hooks.once).not.toHaveBeenCalled();
	});
});
