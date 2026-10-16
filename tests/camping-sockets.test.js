import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sockets } from "../modules/system/sockets.js";

// The camping socket events carry the scene their session lives on, so the
// GM can apply a player's edit to the right scene whatever it is viewing.
function handler(event) {
	return Hooks.on.mock.calls.find(
		([name]) => name === `litm.socket.${event}`,
	)[1];
}

describe("camping socket events", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		game.socket = { on: vi.fn(), emit: vi.fn() };
		Sockets.registerListeners();
	});

	it("campingSaveOp forwards the scene id with the op", () => {
		handler("campingSaveOp")({
			data: {
				key: "set-type",
				payload: { value: "sojourn" },
				sceneId: "scene-a",
			},
		});

		expect(Hooks.callAll).toHaveBeenCalledWith("litm.camping.saveOp", {
			key: "set-type",
			payload: { value: "sojourn" },
			sceneId: "scene-a",
		});
	});

	it("campingSaveOp from a client without a scene id still forwards the op", () => {
		handler("campingSaveOp")({
			data: { key: "set-type", payload: { value: "camp" } },
		});

		expect(Hooks.callAll).toHaveBeenCalledWith("litm.camping.saveOp", {
			key: "set-type",
			payload: { value: "camp" },
			sceneId: undefined,
		});
	});

	it("campingOpen forwards the scene id so peers bind to the camp's scene", () => {
		handler("campingOpen")({ data: { sceneId: "scene-a" } });

		expect(Hooks.callAll).toHaveBeenCalledWith("litm.camping.open", {
			sceneId: "scene-a",
		});
	});

	it("campingOpen from a client without a scene id still opens", () => {
		handler("campingOpen")({ data: {} });

		expect(Hooks.callAll).toHaveBeenCalledWith("litm.camping.open", {
			sceneId: undefined,
		});
	});
});
