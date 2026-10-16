import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerFellowshipHooks } from "../modules/system/hooks/fellowship-hooks.js";

const FELLOWSHIP_ID = "fellowship-1";

const settings = {};

/** The callback a hook was registered with, by hook name. */
const registered = (mock, name) =>
	mock.mock.calls.find(([hook]) => hook === name)?.[1];

const otherGM = { id: "gm-2", isGM: true };

beforeEach(() => {
	vi.clearAllMocks();
	for (const key of Object.keys(settings)) delete settings[key];
	Object.assign(settings, { use_fellowship: true, fellowshipId: "" });

	game.settings.get.mockImplementation((_ns, key) => settings[key]);
	game.settings.set.mockImplementation(async (_ns, key, value) => {
		settings[key] = value;
	});

	game.user = { id: "gm-1", isGM: true };
	game.users.activeGM = game.user;
	game.actors = { get: vi.fn(), find: vi.fn(), filter: vi.fn(() => []) };

	foundry.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } };
	foundry.documents.Actor.create = vi.fn(async (data) => ({
		id: FELLOWSHIP_ID,
		...data,
	}));
	foundry.documents.Actor.updateDocuments = vi.fn(async () => []);
});

describe("fellowship singleton on ready", () => {
	const runReady = async () => {
		registerFellowshipHooks();
		await registered(Hooks.once, "ready")();
	};

	it("creates the Fellowship on the active GM", async () => {
		await runReady();

		expect(foundry.documents.Actor.create).toHaveBeenCalledTimes(1);
		expect(settings.fellowshipId).toBe(FELLOWSHIP_ID);
	});

	it("does not create a second Fellowship from a GM that is not the active one", async () => {
		game.users.activeGM = otherGM;

		await runReady();

		expect(foundry.documents.Actor.create).not.toHaveBeenCalled();
		expect(game.settings.set).not.toHaveBeenCalled();
	});

	it("does nothing for a player", async () => {
		game.user = { id: "player-1", isGM: false };
		game.users.activeGM = otherGM;

		await runReady();

		expect(foundry.documents.Actor.create).not.toHaveBeenCalled();
	});
});

describe("auto-linking a new hero", () => {
	const hero = () => ({
		type: "hero",
		pack: null,
		system: { fellowshipId: "" },
		update: vi.fn(async () => undefined),
	});

	const createActor = () => {
		registerFellowshipHooks();
		return registered(Hooks.on, "createActor");
	};

	beforeEach(() => {
		settings.fellowshipId = FELLOWSHIP_ID;
	});

	it("links the hero on the active GM", async () => {
		const actor = hero();

		await createActor()(actor);

		expect(actor.update).toHaveBeenCalledWith({
			"system.fellowshipId": FELLOWSHIP_ID,
		});
	});

	it("leaves the write to the active GM when another GM is also connected", async () => {
		game.users.activeGM = otherGM;
		const actor = hero();

		await createActor()(actor);

		expect(actor.update).not.toHaveBeenCalled();
	});
});
