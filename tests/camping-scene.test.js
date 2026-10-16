import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
	LitmCampingScene,
	liveIds,
} from "../modules/apps/camping/camping-scene.js";
import { defaultCampingState } from "../modules/apps/camping/camping-state.js";
import { ContentSources } from "../modules/system/content-sources.js";
import { Sockets } from "../modules/system/sockets.js";

vi.mock("../modules/system/content-sources.js", () => ({
	ContentSources: {
		getStoryTags: vi.fn(),
		deleteStoryTags: vi.fn(),
		createStoryTags: vi.fn(),
	},
}));
vi.mock("../modules/system/sockets.js", () => ({
	Sockets: { dispatch: vi.fn() },
}));

const actions = LitmCampingScene.DEFAULT_OPTIONS.actions;

// A scene that stores flags the way the real document does for our purposes:
// setFlag writes, unsetFlag removes, reads go through `flags`.
function fakeScene({ id = "scene-a", camping = null } = {}) {
	const scene = {
		id,
		flags: camping ? { litmv2: { camping: structuredClone(camping) } } : {},
		setFlag: vi.fn(async (scope, key, value) => {
			scene.flags[scope] ??= {};
			scene.flags[scope][key] = structuredClone(value);
		}),
		unsetFlag: vi.fn(async (scope, key) => {
			delete scene.flags[scope]?.[key];
		}),
	};
	return scene;
}

const sessionOf = (scene) => scene.flags.litmv2?.camping;

// The story-tag pack. `deleteStoryTags` mirrors Foundry's strict lookup:
// one missing id throws and nothing is deleted.
let pack;
function seedPack(...ids) {
	pack = new Map(ids.map((id) => [id, { id }]));
}

beforeAll(() => {
	globalThis.CONFIG.litmv2.tagStringRe =
		/\[([^[\]!:-]+)(!)?(?:([-:])(\d+)?)?\]/g;
});

beforeEach(() => {
	vi.clearAllMocks();
	seedPack();
	ContentSources.getStoryTags.mockImplementation(async () => [
		...pack.values(),
	]);
	ContentSources.deleteStoryTags.mockImplementation(async (ids) => {
		const missing = ids.filter((id) => !pack.has(id));
		if (missing.length) {
			throw new Error(`ActiveEffect "${missing[0]}" does not exist!`);
		}
		for (const id of ids) pack.delete(id);
	});
	ContentSources.createStoryTags.mockResolvedValue([]);
	game.user = { id: "gm", isGM: true };
	game.users.activeGM = game.user;
	globalThis.canvas = { scene: null };
});

describe("liveIds", () => {
	it("keeps only ids that still resolve to an effect, in order", () => {
		const live = [{ id: "a" }, { id: "c" }];
		expect(liveIds(["c", "b", "a"], live)).toEqual(["c", "a"]);
	});

	it("tolerates a missing id list", () => {
		expect(liveIds(undefined, [{ id: "a" }])).toEqual([]);
		expect(liveIds(null, [])).toEqual([]);
	});
});

describe("Cancel", () => {
	function session(createdIds) {
		const state = defaultCampingState();
		state.phase = "active";
		state.placeOfStay.createdCampsiteEffectIds = createdIds;
		return state;
	}

	it("rolls back only the campsite tags that still exist, then clears the session", async () => {
		seedPack("live-1");
		const scene = fakeScene({ camping: session(["live-1", "gone-1"]) });
		canvas.scene = scene;

		await actions.cancel();

		expect(ContentSources.deleteStoryTags).toHaveBeenCalledWith(["live-1"]);
		expect(scene.unsetFlag).toHaveBeenCalledWith("litmv2", "camping");
		expect(sessionOf(scene)).toBeUndefined();
	});

	it("does not call delete when every campsite tag is already gone", async () => {
		const scene = fakeScene({ camping: session(["gone-1"]) });
		canvas.scene = scene;

		await actions.cancel();

		expect(ContentSources.deleteStoryTags).not.toHaveBeenCalled();
		expect(scene.unsetFlag).toHaveBeenCalledWith("litmv2", "camping");
	});

	it("still clears the session when the rollback itself fails", async () => {
		seedPack("live-1");
		ContentSources.deleteStoryTags.mockRejectedValueOnce(new Error("socket"));
		const scene = fakeScene({ camping: session(["live-1"]) });
		canvas.scene = scene;

		await expect(actions.cancel()).rejects.toThrow("socket");

		expect(scene.unsetFlag).toHaveBeenCalledWith("litmv2", "camping");
	});
});

describe("Begin Camp", () => {
	it("expires only the scene tags that still exist, and still begins", async () => {
		seedPack("keep-me", "expire-live");
		const state = defaultCampingState();
		state.placeOfStay.sceneTagsToExpire = ["expire-live", "expire-gone"];
		const scene = fakeScene({ camping: state });
		canvas.scene = scene;

		await actions["begin-camp"]();

		expect(ContentSources.deleteStoryTags).toHaveBeenCalledWith([
			"expire-live",
		]);
		expect(sessionOf(scene).phase).toBe("active");
		expect(sessionOf(scene).placeOfStay.sceneTagsToExpire).toEqual([]);
		expect(Sockets.dispatch).toHaveBeenCalledWith("campingOpen", {});
	});

	it("does not call delete when every flagged scene tag is already gone", async () => {
		const state = defaultCampingState();
		state.placeOfStay.sceneTagsToExpire = ["expire-gone"];
		const scene = fakeScene({ camping: state });
		canvas.scene = scene;

		await actions["begin-camp"]();

		expect(ContentSources.deleteStoryTags).not.toHaveBeenCalled();
		expect(sessionOf(scene).phase).toBe("active");
	});
});
