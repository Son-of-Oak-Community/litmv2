import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Sockets } from "../modules/system/sockets.js";

// Spend Power's Recover can name a Fellowship tag the player can't write, so
// the player's client asks the active GM to do it — the inverse of the
// scratchEffect relay.

const hooks = new Map();
let onPacket;

const users = {
	gm: { id: "gm", isGM: true },
	alice: { id: "alice", isGM: false },
};

beforeAll(() => {
	Hooks.on.mockImplementation((name, cb) => {
		if (!hooks.has(name)) hooks.set(name, []);
		hooks.get(name).push(cb);
	});
	Hooks.callAll.mockImplementation((name, ...args) => {
		for (const cb of hooks.get(name) ?? []) cb(...args);
	});
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
});

const scratchedTag = () => ({
	system: { isScratched: true },
	update: vi.fn(async () => {}),
});

describe("recoverEffect relay", () => {
	it("un-scratches the tag on the active GM's client", async () => {
		const effect = scratchedTag();
		foundry.utils.fromUuid.mockResolvedValue(effect);

		onPacket({ event: "recoverEffect", data: { uuid: "Effect.ft1" } }, "alice");

		await vi.waitFor(() =>
			expect(effect.update).toHaveBeenCalledWith({
				"system.isScratched": false,
			}),
		);
		expect(foundry.utils.fromUuid).toHaveBeenCalledWith("Effect.ft1");
	});

	it("sets, never toggles: a replayed request leaves a recovered tag alone", async () => {
		const effect = scratchedTag();
		effect.system.isScratched = false;
		foundry.utils.fromUuid.mockResolvedValue(effect);

		onPacket({ event: "recoverEffect", data: { uuid: "Effect.ft1" } }, "alice");

		await vi.waitFor(() => expect(foundry.utils.fromUuid).toHaveBeenCalled());
		expect(effect.update).not.toHaveBeenCalled();
	});

	it("is ignored by a client that is not the active GM", async () => {
		const effect = scratchedTag();
		foundry.utils.fromUuid.mockResolvedValue(effect);
		game.user = users.alice;

		onPacket({ event: "recoverEffect", data: { uuid: "Effect.ft1" } }, "gm");

		expect(foundry.utils.fromUuid).not.toHaveBeenCalled();
		expect(effect.update).not.toHaveBeenCalled();
	});

	it("tolerates a vanished effect", async () => {
		foundry.utils.fromUuid.mockResolvedValue(null);
		onPacket(
			{ event: "recoverEffect", data: { uuid: "Effect.gone" } },
			"alice",
		);
		await vi.waitFor(() => expect(foundry.utils.fromUuid).toHaveBeenCalled());
	});
});
