import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { scratchOnce } from "../modules/active-effects/scratchable-mixin.js";
import { Sockets } from "../modules/system/sockets.js";

// The sender of a system socket packet is the id the Foundry server appends
// as the listener's second argument (`handleCustomSocket`), never a field a
// client wrote into the payload.

const hooks = new Map();
let onPacket;

const users = {
	gm: { id: "gm", isGM: true },
	alice: { id: "alice", isGM: false, character: null, update: vi.fn() },
	bob: { id: "bob", isGM: false, character: null, update: vi.fn() },
};

beforeAll(() => {
	Hooks.on.mockImplementation((name, cb) => {
		if (!hooks.has(name)) hooks.set(name, []);
		hooks.get(name).push(cb);
	});
	Hooks.callAll.mockImplementation((name, ...args) => {
		for (const cb of hooks.get(name) ?? []) cb(...args);
	});
	foundry.CONST ??= {};
	foundry.CONST.DOCUMENT_OWNERSHIP_LEVELS ??= { NONE: 0, OWNER: 3 };
	game.ready = true;
	game.socket = {
		emit: vi.fn(),
		on: vi.fn((_channel, cb) => {
			onPacket = cb;
		}),
	};
	Sockets.registerListeners();
});

beforeEach(() => {
	vi.clearAllMocks();
	game.users.get = vi.fn((id) => users[id]);
	game.userId = "gm";
	game.user = users.gm;
	game.users.activeGM = users.gm;
	users.alice.character = null;
});

describe("Sockets attested sender", () => {
	it("dispatch sends no senderId", () => {
		Sockets.dispatch("ping", { a: 1 });
		const [, packet] = game.socket.emit.mock.calls[0];
		expect(packet).not.toHaveProperty("senderId");
	});

	it("hands handlers the server's sender, not the payload's", () => {
		const seen = vi.fn();
		Sockets.on("probe", seen);
		onPacket({ event: "probe", senderId: "gm", data: {} }, "alice");
		expect(seen).toHaveBeenCalledWith(
			expect.objectContaining({ senderId: "alice" }),
		);
	});

	it("drops a packet with no attested sender", () => {
		const seen = vi.fn();
		Sockets.on("probe2", seen);
		onPacket({ event: "probe2", senderId: "alice", data: {} }, undefined);
		expect(seen).not.toHaveBeenCalled();
	});
});

describe("createHeroAsGM relay", () => {
	const create = foundry.documents.Actor;

	beforeEach(() => {
		create.create = vi.fn(async () => ({ id: "hero-1" }));
	});

	it("owns and assigns the hero to the sender only", async () => {
		const actorData = {
			name: "Kael",
			type: "hero",
			ownership: { bob: 3, default: 3 },
		};
		onPacket(
			{
				event: "createHeroAsGM",
				data: { actorData, userId: "bob", assignToUser: "bob" },
			},
			"alice",
		);
		await vi.waitFor(() => expect(users.alice.update).toHaveBeenCalled());
		const [data] = create.create.mock.calls[0];
		expect(data.ownership).toEqual({
			alice: foundry.CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
		});
		expect(users.alice.update).toHaveBeenCalledWith({ character: "hero-1" });
		expect(users.bob.update).not.toHaveBeenCalled();
	});
});

describe("scratchOnce", () => {
	it("sets the tag scratched rather than toggling it", async () => {
		const effect = {
			parent: { documentName: "Actor" },
			system: { isScratched: false, setScratched: vi.fn() },
		};
		await scratchOnce(effect);
		expect(effect.system.setScratched).toHaveBeenCalledWith(true);
	});

	it("leaves an already scratched tag alone", async () => {
		const effect = {
			parent: { documentName: "Actor" },
			system: { isScratched: true, setScratched: vi.fn() },
		};
		await scratchOnce(effect);
		expect(effect.system.setScratched).not.toHaveBeenCalled();
	});
});
