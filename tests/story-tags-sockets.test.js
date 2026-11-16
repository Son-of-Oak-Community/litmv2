import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sockets } from "../modules/system/sockets.js";

// sockets.js: "Exactly one GM applies the world-pack write — the active GM —
// regardless of whether the Tags sidebar is open on any client." The gate it
// replaced dropped player edits when the Narrator's sidebar was closed and
// applied them twice when two Narrators had it open.

function handler(event) {
	return Hooks.on.mock.calls.find(
		([name]) => name === `litm.socket.${event}`,
	)[1];
}

let sidebar;
const packet = {
	senderId: "player",
	data: { operation: "createTags", data: [{ name: "fog" }] },
};

beforeEach(() => {
	vi.clearAllMocks();
	game.socket = { on: vi.fn(), emit: vi.fn() };
	sidebar = {
		rendered: false,
		doUpdate: vi.fn().mockResolvedValue(undefined),
		invalidateCache: vi.fn(),
		render: vi.fn(),
	};
	game.litmv2 = { storyTags: sidebar };
	game.user = { id: "gm-1", isGM: true };
	game.users = { activeGM: game.user, get: vi.fn() };
	Sockets.registerListeners();
});

afterEach(() => {
	delete game.litmv2;
});

describe("storyTagsUpdate", () => {
	it("is applied by the active Narrator, sidebar open or not", async () => {
		await handler("storyTagsUpdate")(packet);

		expect(sidebar.doUpdate).toHaveBeenCalledTimes(1);
		expect(sidebar.doUpdate).toHaveBeenCalledWith("createTags", [
			{ name: "fog" },
		]);
	});

	it("is left alone by a second Narrator, so the write lands once", async () => {
		game.users.activeGM = { id: "gm-2", isGM: true };

		await handler("storyTagsUpdate")(packet);

		expect(sidebar.doUpdate).not.toHaveBeenCalled();
	});

	it("is left alone by a player's client", async () => {
		game.user = { id: "player-2", isGM: false };

		await handler("storyTagsUpdate")(packet);

		expect(sidebar.doUpdate).not.toHaveBeenCalled();
	});

	it("does not throw when the write fails", async () => {
		sidebar.doUpdate.mockRejectedValue(new Error("pack locked"));

		await expect(handler("storyTagsUpdate")(packet)).resolves.toBeUndefined();
	});
});

describe("storyTagsRender", () => {
	it("re-renders an open sidebar from fresh data and announces the change", () => {
		sidebar.rendered = true;

		handler("storyTagsRender")({});

		expect(sidebar.invalidateCache).toHaveBeenCalled();
		expect(sidebar.render).toHaveBeenCalled();
		expect(Hooks.callAll).toHaveBeenCalledWith("litm.sceneTagsChanged");
	});

	it("still announces the change when the sidebar is closed", () => {
		handler("storyTagsRender")({});

		expect(sidebar.render).not.toHaveBeenCalled();
		expect(Hooks.callAll).toHaveBeenCalledWith("litm.sceneTagsChanged");
	});
});
