import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	applyOperations,
	buildOperations,
} from "../modules/apps/camping/camping-apply.js";
import {
	buildThreatsContext,
	getCampingHeroes,
} from "../modules/apps/camping/camping-context.js";
import {
	enqueueOp,
	enrichThreats,
	LitmCampingScene,
	liveIds,
} from "../modules/apps/camping/camping-scene.js";
import { defaultCampingState } from "../modules/apps/camping/camping-state.js";
import { error, warn } from "../modules/logger.js";
import { ContentSources } from "../modules/system/content-sources.js";
import { Sockets } from "../modules/system/sockets.js";
import { withFlags } from "./__helpers__/flags.js";
import { setGM, setPlayer } from "./__helpers__/users.js";

// Pack Up's document writes live in the apply layer, which has its own tests;
// here we only care about the order and guarding around them.
vi.mock("../modules/apps/camping/camping-apply.js", async (original) => ({
	...(await original()),
	buildOperations: vi.fn(),
	applyOperations: vi.fn(),
}));
vi.mock("../modules/apps/camping/camping-context.js", async (original) => ({
	...(await original()),
	getCampingHeroes: vi.fn(() => []),
	buildThreatsContext: vi.fn(() => []),
}));
vi.mock("../modules/logger.js", () => ({
	error: vi.fn(),
	warn: vi.fn(),
	info: vi.fn(),
	success: vi.fn(),
}));
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
	return withFlags({ id }, camping ? { litmv2: { camping } } : {});
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
	foundry.utils.hasProperty ??= (obj, path) =>
		foundry.utils.getProperty(obj, path) !== undefined;
	foundry.utils.debounce ??= (fn) => fn;
	// The window itself is out of scope; keep render/close observable.
	LitmCampingScene.prototype.render = vi.fn();
	foundry.applications.api.ApplicationV2.prototype.close = vi.fn(
		async () => {},
	);
});

afterEach(async () => {
	// Releases the scene this client's camp window is bound to.
	await LitmCampingScene.close({ fromSocket: true });
});

beforeEach(() => {
	vi.clearAllMocks();
	game.scenes = { get: vi.fn(() => undefined) };
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
	setGM();
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

describe("enrichThreats", () => {
	it("enriches threat and consequences against the vignette item, so statuses render as chips", async () => {
		const item = { id: "v1", isOwner: true };
		game.items = { get: vi.fn(() => item) };
		const enrich = vi.fn(async (text) => `<chip>${text}</chip>`);
		foundry.applications.ux = { TextEditor: { enrichHTML: enrich } };

		const [out] = await enrichThreats([
			{
				id: "v1",
				name: "Heavy Rain",
				threat: "Rain [wet-3]",
				consequences: ["[cold-2]", "[muddy-2]"],
				isConsequenceOnly: false,
			},
		]);

		expect(out).toEqual({
			id: "v1",
			name: "Heavy Rain",
			threat: "<chip>Rain [wet-3]</chip>",
			consequences: ["<chip>[cold-2]</chip>", "<chip>[muddy-2]</chip>"],
			isConsequenceOnly: false,
		});
		expect(enrich).toHaveBeenCalledWith(
			"Rain [wet-3]",
			expect.objectContaining({ relativeTo: item }),
		);
		delete foundry.applications.ux;
	});
});

describe("Cancel", () => {
	function session(createdIds) {
		const state = defaultCampingState();
		state.phase = "active";
		state.placeOfStay.createdCampsiteEffectIds = createdIds;
		return state;
	}

	beforeEach(() => {
		vi.spyOn(foundry.applications.api.DialogV2, "confirm").mockResolvedValue(
			true,
		);
	});

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
		expect(Sockets.dispatch).toHaveBeenCalledWith("campingOpen", {
			sceneId: "scene-a",
		});
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

	describe("when it may only begin once", () => {
		function setupWithCampsiteTag() {
			const state = defaultCampingState();
			state.placeOfStay.campsiteTags = "[Warm fire]";
			return state;
		}

		beforeEach(() => {
			ContentSources.createStoryTags.mockResolvedValue([{ id: "new-1" }]);
		});

		it("creates the campsite tags once when clicked twice in a row", async () => {
			const scene = fakeScene({ camping: setupWithCampsiteTag() });
			canvas.scene = scene;

			await Promise.all([actions["begin-camp"](), actions["begin-camp"]()]);

			expect(ContentSources.createStoryTags).toHaveBeenCalledTimes(1);
			expect(sessionOf(scene).phase).toBe("active");
			expect(sessionOf(scene).placeOfStay.createdCampsiteEffectIds).toEqual([
				"new-1",
			]);
		});

		it("leaves a camp that has already begun alone and tells the GM", async () => {
			const state = setupWithCampsiteTag();
			state.phase = "active";
			state.campId = "camp-1";
			state.placeOfStay.createdCampsiteEffectIds = ["live-1"];
			const scene = fakeScene({ camping: state });
			canvas.scene = scene;

			await actions["begin-camp"]();

			expect(ContentSources.createStoryTags).not.toHaveBeenCalled();
			expect(ContentSources.deleteStoryTags).not.toHaveBeenCalled();
			expect(scene.setFlag).not.toHaveBeenCalled();
			expect(sessionOf(scene).campId).toBe("camp-1");
			expect(Sockets.dispatch).not.toHaveBeenCalledWith(
				"campingOpen",
				expect.anything(),
			);
			expect(ui.notifications.warn).toHaveBeenCalledWith(
				"LITM.Ui.camping_begin_already",
			);
		});

		it("only logs when the action was relayed from a second GM", async () => {
			const state = setupWithCampsiteTag();
			state.phase = "active";
			const scene = fakeScene({ camping: state });
			game.scenes.get.mockImplementation((id) =>
				id === "scene-a" ? scene : undefined,
			);
			LitmCampingScene.registerSocketHooks();
			const onLifecycle = Hooks.on.mock.calls.find(
				([n]) => n === "litm.camping.lifecycle",
			)[1];

			await onLifecycle({ action: "begin-camp", sceneId: "scene-a" });

			expect(ContentSources.createStoryTags).not.toHaveBeenCalled();
			expect(ui.notifications.warn).not.toHaveBeenCalled();
			expect(warn).toHaveBeenCalledTimes(1);
		});
	});
});

describe("Pack Up", () => {
	function activeSession(overrides = {}) {
		const state = defaultCampingState();
		state.phase = "active";
		state.campId = "camp-1";
		return Object.assign(state, overrides);
	}

	beforeEach(() => {
		vi.spyOn(foundry.applications.api.DialogV2, "confirm").mockResolvedValue(
			true,
		);
		getCampingHeroes.mockReturnValue([]);
		buildThreatsContext.mockReturnValue([]);
		buildOperations.mockReturnValue({ operations: {}, recap: {} });
		applyOperations.mockResolvedValue(undefined);
	});

	it("persists a packingUp guard before applying, then closes and clears the session", async () => {
		const scene = fakeScene({ camping: activeSession() });
		canvas.scene = scene;
		let guardDuringApply;
		applyOperations.mockImplementation(async () => {
			guardDuringApply = sessionOf(scene).packingUp;
		});

		await actions["pack-up"]();

		expect(guardDuringApply).toBe(true);
		expect(applyOperations).toHaveBeenCalledTimes(1);
		expect(foundry.documents.ChatMessage.create).toHaveBeenCalledTimes(1);
		expect(Sockets.dispatch).toHaveBeenCalledWith("campingEnd", {});
		expect(sessionOf(scene)).toBeUndefined();
	});

	it("refuses a second Pack Up while one is already running", async () => {
		const scene = fakeScene({ camping: activeSession({ packingUp: true }) });
		canvas.scene = scene;

		await actions["pack-up"]();

		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.camping_pack_up_in_progress",
		);
		expect(buildOperations).not.toHaveBeenCalled();
		expect(applyOperations).not.toHaveBeenCalled();
		expect(scene.unsetFlag).not.toHaveBeenCalled();
		expect(sessionOf(scene).packingUp).toBe(true);
	});

	it("applies once when Pack Up is clicked twice in a row", async () => {
		const scene = fakeScene({ camping: activeSession() });
		canvas.scene = scene;

		await Promise.all([actions["pack-up"](), actions["pack-up"]()]);

		expect(applyOperations).toHaveBeenCalledTimes(1);
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.camping_pack_up_in_progress",
		);
	});

	it("closes the session and tells the GM when applying fails partway", async () => {
		const scene = fakeScene({ camping: activeSession() });
		canvas.scene = scene;
		applyOperations.mockRejectedValueOnce(new Error("boom"));

		await expect(actions["pack-up"]()).resolves.toBeUndefined();

		expect(ui.notifications.error).toHaveBeenCalledWith(
			"LITM.Ui.camping_pack_up_failed_partial",
		);
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
		expect(Sockets.dispatch).toHaveBeenCalledWith("campingEnd", {});
		// The half-applied session must not survive to be re-run.
		expect(scene.unsetFlag).toHaveBeenCalledWith("litmv2", "camping");
		expect(sessionOf(scene)).toBeUndefined();
	});

	it("leaves the session intact and retryable when it fails before anything is applied", async () => {
		const scene = fakeScene({ camping: activeSession() });
		canvas.scene = scene;
		ContentSources.getStoryTags.mockRejectedValueOnce(new Error("offline"));

		await actions["pack-up"]();

		expect(ui.notifications.error).toHaveBeenCalledWith(
			"LITM.Ui.camping_pack_up_failed",
		);
		expect(applyOperations).not.toHaveBeenCalled();
		expect(scene.unsetFlag).not.toHaveBeenCalled();
		expect(sessionOf(scene).packingUp).toBe(false);

		// A retry goes through.
		await actions["pack-up"]();
		expect(applyOperations).toHaveBeenCalledTimes(1);
	});

	it("drops queued edits once Pack Up has started", async () => {
		const scene = fakeScene({ camping: activeSession({ packingUp: true }) });
		canvas.scene = scene;

		await enqueueOp("set-type", { value: "sojourn" });

		expect(scene.setFlag).not.toHaveBeenCalled();
		expect(sessionOf(scene).type).toBe("camp");
	});
});

describe("scene binding", () => {
	let sceneA;
	let sceneB;

	// The session on A is the camp; B is whatever the GM wandered off to.
	beforeEach(() => {
		sceneA = fakeScene({ id: "scene-a" });
		sceneB = fakeScene({ id: "scene-b" });
		game.scenes.get.mockImplementation(
			(id) => ({ "scene-a": sceneA, "scene-b": sceneB })[id],
		);
	});

	const hook = (name) => {
		LitmCampingScene.registerSocketHooks();
		return Hooks.on.mock.calls.find(([n]) => n === name)[1];
	};

	it("names the bound scene in the window title, unless it is hidden", () => {
		const base = Object.getPrototypeOf(LitmCampingScene.prototype);
		Object.defineProperty(base, "title", {
			get: () => "Camping",
			configurable: true,
		});
		Object.assign(sceneA, {
			name: "Simple Battle",
			navName: "Battle",
			navigation: true,
		});
		canvas.scene = sceneA;
		const app = LitmCampingScene.open();

		sceneA.visible = false;
		// The Narrator always knows which scene the camp is on.
		expect(app.title).toBe("Camping — Battle");
		setPlayer();
		sceneA.visible = true;
		expect(app.title).toBe("Camping — Battle");
		sceneA.visible = false;
		expect(app.title).toBe("Camping");
		delete base.title;
	});

	it("strips a running camp from a copied or imported scene", () => {
		const del = Symbol("del");
		globalThis._del = del;
		const copy = {
			flags: { litmv2: { camping: { phase: "active" } } },
			updateSource: vi.fn(),
		};
		const plain = { flags: {}, updateSource: vi.fn() };

		const preCreate = hook("preCreateScene");
		preCreate(copy);
		preCreate(plain);

		expect(copy.updateSource).toHaveBeenCalledWith({
			"flags.litmv2.camping": del,
		});
		expect(plain.updateSource).not.toHaveBeenCalled();
		delete globalThis._del;
	});

	it("records the scene id in the session it opens", () => {
		canvas.scene = sceneA;

		LitmCampingScene.open();

		expect(sessionOf(sceneA)).toMatchObject({
			phase: "setup",
			sceneId: "scene-a",
		});
	});

	it("keeps a GM editing the camp's own scene after navigating to another", async () => {
		canvas.scene = sceneA;
		LitmCampingScene.open();
		sceneB.flags = { litmv2: { camping: defaultCampingState() } };
		canvas.scene = sceneB;

		await enqueueOp("set-type", { value: "sojourn" });

		expect(sessionOf(sceneA).type).toBe("sojourn");
		expect(sessionOf(sceneB).type).toBe("camp");
		expect(sceneB.setFlag).not.toHaveBeenCalled();
	});

	it("reopening from another scene resumes the live session instead of starting a second", () => {
		canvas.scene = sceneA;
		LitmCampingScene.open();
		canvas.scene = sceneB;

		LitmCampingScene.open();

		expect(sceneB.setFlag).not.toHaveBeenCalled();
		expect(sessionOf(sceneB)).toBeUndefined();
	});

	it("a player's edit names the scene the camp is bound to", async () => {
		setPlayer();
		canvas.scene = sceneA;
		LitmCampingScene.open();

		await enqueueOp("set-type", { value: "sojourn" });

		expect(Sockets.dispatch).toHaveBeenCalledWith("campingSaveOp", {
			key: "set-type",
			payload: { value: "sojourn" },
			sceneId: "scene-a",
		});
	});

	it("a peer opened by the GM binds to the scene the GM names", async () => {
		setPlayer();
		canvas.scene = sceneA;

		hook("litm.camping.open")({ sceneId: "scene-b" });
		await enqueueOp("set-type", { value: "sojourn" });

		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"campingSaveOp",
			expect.objectContaining({ sceneId: "scene-b" }),
		);
	});

	it("a peer falls back to the scene it is viewing when the named scene is not available to it", async () => {
		setPlayer();
		canvas.scene = sceneA;

		hook("litm.camping.open")({ sceneId: "scene-unknown" });
		await enqueueOp("set-type", { value: "sojourn" });

		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"campingSaveOp",
			expect.objectContaining({ sceneId: "scene-a" }),
		);
	});

	describe("a second GM's edits", () => {
		const edit = { value: "sojourn" };

		beforeEach(() => {
			sceneA.flags = { litmv2: { camping: defaultCampingState() } };
			canvas.scene = sceneA;
		});

		it("go through the active GM's queue via the socket, not straight to the scene", async () => {
			setGM("gm-2");
			game.users.activeGM = { id: "gm-1", isGM: true };

			await enqueueOp("set-type", edit);

			expect(sceneA.setFlag).not.toHaveBeenCalled();
			expect(Sockets.dispatch).toHaveBeenCalledWith("campingSaveOp", {
				key: "set-type",
				payload: edit,
				sceneId: "scene-a",
			});
		});

		it("are applied locally by the active GM", async () => {
			await enqueueOp("set-type", edit);

			expect(sessionOf(sceneA).type).toBe("sojourn");
			expect(Sockets.dispatch).not.toHaveBeenCalled();
		});

		it("are applied locally when Foundry reports no active GM", async () => {
			game.users.activeGM = null;

			await enqueueOp("set-type", edit);

			expect(sessionOf(sceneA).type).toBe("sojourn");
		});
	});

	it("opens without arguments, as the hero sheet calls it", () => {
		canvas.scene = sceneA;
		expect(() => hook("litm.camping.open")()).not.toThrow();
	});

	describe("the active GM applying a player's edit", () => {
		beforeEach(() => {
			sceneA.flags = { litmv2: { camping: defaultCampingState() } };
			sceneB.flags = { litmv2: { camping: defaultCampingState() } };
			canvas.scene = sceneB; // the GM is looking at the other scene
		});

		const edit = { key: "set-type", payload: { value: "sojourn" } };

		it("applies it to the scene the op names, not the one being viewed", async () => {
			await hook("litm.camping.saveOp")({ ...edit, sceneId: "scene-a" });

			expect(sessionOf(sceneA).type).toBe("sojourn");
			expect(sessionOf(sceneB).type).toBe("camp");
			expect(sceneB.setFlag).not.toHaveBeenCalled();
		});

		it("falls back to the viewed scene for an op that carries no scene id", async () => {
			await hook("litm.camping.saveOp")(edit);

			expect(sessionOf(sceneB).type).toBe("sojourn");
			expect(sessionOf(sceneA).type).toBe("camp");
		});

		it("drops an op that names a scene that no longer exists", async () => {
			await hook("litm.camping.saveOp")({ ...edit, sceneId: "scene-gone" });

			expect(sceneA.setFlag).not.toHaveBeenCalled();
			expect(sceneB.setFlag).not.toHaveBeenCalled();
		});

		it("is ignored by a GM that is not the active one", async () => {
			game.users.activeGM = { id: "other-gm" };

			await hook("litm.camping.saveOp")({ ...edit, sceneId: "scene-a" });

			expect(sceneA.setFlag).not.toHaveBeenCalled();
		});
	});

	it("re-renders when the bound scene's session changes, even while viewing another", () => {
		canvas.scene = sceneA;
		LitmCampingScene.open();
		canvas.scene = sceneB;
		const onUpdateScene = hook("updateScene");
		const change = { flags: { litmv2: { camping: { type: "sojourn" } } } };
		LitmCampingScene.prototype.render.mockClear();

		onUpdateScene(sceneB, change);
		expect(LitmCampingScene.prototype.render).not.toHaveBeenCalled();

		onUpdateScene(sceneA, change);
		expect(LitmCampingScene.prototype.render).toHaveBeenCalledTimes(1);
	});

	it("releases the binding when the session ends", async () => {
		canvas.scene = sceneA;
		LitmCampingScene.open();
		canvas.scene = sceneB;

		await LitmCampingScene.close({ fromSocket: true });
		setPlayer();
		await enqueueOp("set-type", { value: "sojourn" });

		expect(Sockets.dispatch).toHaveBeenCalledWith(
			"campingSaveOp",
			expect.objectContaining({ sceneId: "scene-b" }),
		);
	});
});

// Begin Camp, Pack Up and Cancel write the scene flag and story tags. Only the
// active GM holds the apply queue, so a second GM relays them rather than
// racing the active GM's queued edits.
describe("camp lifecycle with a second GM", () => {
	let sceneA;
	let sceneB;

	const hook = (name) => {
		LitmCampingScene.registerSocketHooks();
		return Hooks.on.mock.calls.find(([n]) => n === name)[1];
	};

	const activeSession = () => {
		const state = defaultCampingState();
		state.phase = "active";
		state.campId = "camp-1";
		state.placeOfStay.createdCampsiteEffectIds = ["live-1"];
		return state;
	};

	const asSecondGM = () => {
		setGM("gm-2");
		game.users.activeGM = { id: "gm-1", isGM: true };
	};

	beforeEach(() => {
		sceneA = fakeScene({ id: "scene-a", camping: defaultCampingState() });
		sceneB = fakeScene({ id: "scene-b", camping: activeSession() });
		game.scenes.get.mockImplementation(
			(id) => ({ "scene-a": sceneA, "scene-b": sceneB })[id],
		);
		canvas.scene = sceneA;
		seedPack("live-1");
		vi.spyOn(foundry.applications.api.DialogV2, "confirm").mockResolvedValue(
			true,
		);
		buildOperations.mockReturnValue({ operations: {}, recap: {} });
		applyOperations.mockResolvedValue(undefined);
	});

	describe("a second GM", () => {
		beforeEach(() => {
			asSecondGM();
			const state = defaultCampingState();
			state.placeOfStay.sceneTagsToExpire = ["live-1"];
			state.placeOfStay.campsiteTags = "[Warm fire]";
			sceneA.flags = { litmv2: { camping: state } };
		});

		it("asks the active GM to Begin Camp instead of writing the scene", async () => {
			await actions["begin-camp"]();

			expect(Sockets.dispatch).toHaveBeenCalledTimes(1);
			expect(Sockets.dispatch).toHaveBeenCalledWith("campingLifecycle", {
				action: "begin-camp",
				sceneId: "scene-a",
			});
			expect(sceneA.setFlag).not.toHaveBeenCalled();
			expect(ContentSources.deleteStoryTags).not.toHaveBeenCalled();
			expect(ContentSources.createStoryTags).not.toHaveBeenCalled();
		});

		it("confirms Pack Up on its own client, then asks the active GM to run it", async () => {
			sceneA.flags = { litmv2: { camping: activeSession() } };

			await actions["pack-up"]();

			expect(foundry.applications.api.DialogV2.confirm).toHaveBeenCalledTimes(
				1,
			);
			expect(Sockets.dispatch).toHaveBeenCalledTimes(1);
			expect(Sockets.dispatch).toHaveBeenCalledWith("campingLifecycle", {
				action: "pack-up",
				sceneId: "scene-a",
			});
			expect(sceneA.setFlag).not.toHaveBeenCalled();
			expect(applyOperations).not.toHaveBeenCalled();
		});

		it("sends nothing when Pack Up is not confirmed", async () => {
			foundry.applications.api.DialogV2.confirm.mockResolvedValue(false);

			await actions["pack-up"]();

			expect(Sockets.dispatch).not.toHaveBeenCalled();
		});

		it("asks the active GM to Cancel instead of discarding the session", async () => {
			sceneA.flags = { litmv2: { camping: activeSession() } };

			await actions.cancel();

			expect(Sockets.dispatch).toHaveBeenCalledTimes(1);
			expect(Sockets.dispatch).toHaveBeenCalledWith("campingLifecycle", {
				action: "cancel",
				sceneId: "scene-a",
			});
			expect(ContentSources.deleteStoryTags).not.toHaveBeenCalled();
			expect(sceneA.unsetFlag).not.toHaveBeenCalled();
		});

		it("keeps a begun camp when Cancel is not confirmed", async () => {
			sceneA.flags = { litmv2: { camping: activeSession() } };
			foundry.applications.api.DialogV2.confirm.mockResolvedValue(false);

			await actions.cancel();

			expect(foundry.applications.api.DialogV2.confirm).toHaveBeenCalledTimes(
				1,
			);
			expect(Sockets.dispatch).not.toHaveBeenCalled();
		});

		it("cancels a camp still in setup without asking", async () => {
			await actions.cancel();

			expect(foundry.applications.api.DialogV2.confirm).not.toHaveBeenCalled();
			expect(Sockets.dispatch).toHaveBeenCalledWith("campingLifecycle", {
				action: "cancel",
				sceneId: "scene-a",
			});
		});

		it("names the camp's scene, not the one it is viewing", async () => {
			sceneA.flags = { litmv2: { camping: activeSession() } };
			LitmCampingScene.open();
			canvas.scene = sceneB;
			Sockets.dispatch.mockClear();

			await actions.cancel();

			expect(Sockets.dispatch).toHaveBeenCalledWith("campingLifecycle", {
				action: "cancel",
				sceneId: "scene-a",
			});
		});
	});

	describe("the active GM", () => {
		it("runs Begin Camp locally without relaying", async () => {
			await actions["begin-camp"]();

			expect(sessionOf(sceneA).phase).toBe("active");
			expect(Sockets.dispatch).not.toHaveBeenCalledWith(
				"campingLifecycle",
				expect.anything(),
			);
		});

		it("runs Pack Up locally without relaying", async () => {
			sceneA.flags = { litmv2: { camping: activeSession() } };

			await actions["pack-up"]();

			expect(applyOperations).toHaveBeenCalledTimes(1);
			expect(sessionOf(sceneA)).toBeUndefined();
			expect(Sockets.dispatch).not.toHaveBeenCalledWith(
				"campingLifecycle",
				expect.anything(),
			);
		});

		it("runs Cancel locally without relaying", async () => {
			sceneA.flags = { litmv2: { camping: activeSession() } };

			await actions.cancel();

			expect(sessionOf(sceneA)).toBeUndefined();
			expect(Sockets.dispatch).not.toHaveBeenCalledWith(
				"campingLifecycle",
				expect.anything(),
			);
		});

		it("runs locally when Foundry reports no active GM", async () => {
			game.users.activeGM = null;
			sceneA.flags = { litmv2: { camping: activeSession() } };

			await actions.cancel();

			expect(sessionOf(sceneA)).toBeUndefined();
			expect(Sockets.dispatch).not.toHaveBeenCalledWith(
				"campingLifecycle",
				expect.anything(),
			);
		});
	});

	it("a player's Cancel only closes their own window", async () => {
		setPlayer();
		sceneA.flags = { litmv2: { camping: activeSession() } };

		await actions.cancel();

		expect(Sockets.dispatch).not.toHaveBeenCalled();
		expect(sceneA.unsetFlag).not.toHaveBeenCalled();
	});

	describe("the active GM receiving a relayed action", () => {
		// This client is looking at scene A with no camp window open: the
		// relayed action has to name its scene, not lean on this client's view.
		it("Begin Camp runs on the scene it names", async () => {
			sceneB.flags = { litmv2: { camping: defaultCampingState() } };

			await hook("litm.camping.lifecycle")({
				action: "begin-camp",
				sceneId: "scene-b",
			});

			expect(sessionOf(sceneB).phase).toBe("active");
			expect(sceneA.setFlag).not.toHaveBeenCalled();
			expect(Sockets.dispatch).toHaveBeenCalledWith("campingOpen", {
				sceneId: "scene-b",
			});
		});

		it("Pack Up runs on the scene it names, without asking again", async () => {
			await hook("litm.camping.lifecycle")({
				action: "pack-up",
				sceneId: "scene-b",
			});

			expect(foundry.applications.api.DialogV2.confirm).not.toHaveBeenCalled();
			expect(applyOperations).toHaveBeenCalledTimes(1);
			expect(sessionOf(sceneB)).toBeUndefined();
			expect(sceneA.unsetFlag).not.toHaveBeenCalled();
			expect(Sockets.dispatch).toHaveBeenCalledWith("campingEnd", {});
		});

		it("Cancel runs on the scene it names", async () => {
			await hook("litm.camping.lifecycle")({
				action: "cancel",
				sceneId: "scene-b",
			});

			expect(ContentSources.deleteStoryTags).toHaveBeenCalledWith(["live-1"]);
			expect(sessionOf(sceneB)).toBeUndefined();
			expect(sceneA.unsetFlag).not.toHaveBeenCalled();
		});

		it("is ignored by a GM that is not the active one", async () => {
			asSecondGM();

			await hook("litm.camping.lifecycle")({
				action: "cancel",
				sceneId: "scene-b",
			});

			expect(sceneB.unsetFlag).not.toHaveBeenCalled();
			expect(ContentSources.deleteStoryTags).not.toHaveBeenCalled();
		});

		it("is ignored by a player", async () => {
			setPlayer();

			await hook("litm.camping.lifecycle")({
				action: "cancel",
				sceneId: "scene-b",
			});

			expect(sceneB.unsetFlag).not.toHaveBeenCalled();
		});

		it("drops an unknown action", async () => {
			await hook("litm.camping.lifecycle")({
				action: "set-type",
				sceneId: "scene-b",
			});

			expect(sceneB.setFlag).not.toHaveBeenCalled();
			expect(sceneB.unsetFlag).not.toHaveBeenCalled();
		});

		it("drops an action that names no scene or one that is gone", async () => {
			await hook("litm.camping.lifecycle")({ action: "cancel" });
			await hook("litm.camping.lifecycle")({
				action: "cancel",
				sceneId: "scene-gone",
			});

			expect(sceneA.unsetFlag).not.toHaveBeenCalled();
			expect(sceneB.unsetFlag).not.toHaveBeenCalled();
		});

		it("logs a failure instead of throwing into the socket", async () => {
			ContentSources.deleteStoryTags.mockRejectedValueOnce(new Error("socket"));

			await expect(
				hook("litm.camping.lifecycle")({
					action: "cancel",
					sceneId: "scene-b",
				}),
			).resolves.toBeUndefined();

			expect(error).toHaveBeenCalledTimes(1);
			// Cancel still clears the session whatever happens to the rollback.
			expect(sessionOf(sceneB)).toBeUndefined();
		});
	});
});

// Every tag a camp puts in the story-tag pack carries the session's campId:
// the campsite tags Begin Camp creates, and anything added through the sidebar
// while the camp is active. Pack Up deletes by that stamp and nothing else, so
// the table's own scene tags and another scene's camp survive it.
describe("the campId stamp", () => {
	const hook = (name) => {
		LitmCampingScene.registerSocketHooks();
		return Hooks.on.mock.calls.find(([n]) => n === name)[1];
	};

	/** A pack effect, stamped with `campId` when one is given. */
	const packEffect = (id, campId) => ({
		id,
		getFlag: (scope, key) =>
			scope === "litmv2" && key === "campId" ? campId : undefined,
	});

	function activeSession(overrides = {}) {
		const state = defaultCampingState();
		state.phase = "active";
		state.campId = "camp-1";
		return Object.assign(state, overrides);
	}

	describe("Begin Camp", () => {
		beforeEach(() => {
			ContentSources.createStoryTags.mockImplementation(async (data) =>
				data.map((_, i) => ({ id: `new-${i}` })),
			);
		});

		it("stamps every campsite tag it creates with the session's new campId", async () => {
			const state = defaultCampingState();
			state.placeOfStay.campsiteTags = "[Warm fire] [rainy-2] [dry wood!]";
			const scene = fakeScene({ camping: state });
			canvas.scene = scene;

			await actions["begin-camp"]();

			const { campId } = sessionOf(scene);
			expect(campId).toBeTruthy();
			const [created] = ContentSources.createStoryTags.mock.calls[0];
			expect(created.map((e) => [e.type, e.name])).toEqual([
				["story_tag", "Warm fire"],
				["status_tag", "rainy"],
				["story_tag", "dry wood"],
			]);
			for (const effect of created) {
				expect(effect.flags).toEqual({ litmv2: { campId } });
			}
			expect(created[1].system.tiers.indexOf(true)).toBe(1);
			expect(created[2].system.isSingleUse).toBe(true);
			expect(created[0].system.isSingleUse).toBe(false);
		});

		it("keeps a campId the session already carries", async () => {
			const state = defaultCampingState();
			state.campId = "camp-7";
			state.placeOfStay.campsiteTags = "[Warm fire]";
			const scene = fakeScene({ camping: state });
			canvas.scene = scene;

			await actions["begin-camp"]();

			expect(sessionOf(scene).campId).toBe("camp-7");
			const [created] = ContentSources.createStoryTags.mock.calls[0];
			expect(created[0].flags.litmv2.campId).toBe("camp-7");
		});
	});

	describe("a tag added to the story-tag pack during the camp", () => {
		const added = (over = {}) => ({
			pack: "world.litmv2-story-tags",
			getFlag: () => undefined,
			updateSource: vi.fn(),
			...over,
		});

		it("is stamped on the Narrator's client", () => {
			canvas.scene = fakeScene({ camping: activeSession() });
			const effect = added();

			hook("preCreateActiveEffect")(effect);

			expect(effect.updateSource).toHaveBeenCalledWith({
				"flags.litmv2.campId": "camp-1",
			});
		});

		it("is left alone on a player's client", () => {
			canvas.scene = fakeScene({ camping: activeSession() });
			setPlayer();
			const effect = added();

			hook("preCreateActiveEffect")(effect);

			expect(effect.updateSource).not.toHaveBeenCalled();
		});

		it("is left alone when it goes anywhere but the story-tag pack", () => {
			canvas.scene = fakeScene({ camping: activeSession() });
			const onHero = added({ pack: null });
			const elsewhere = added({ pack: "world.other-pack" });

			hook("preCreateActiveEffect")(onHero);
			hook("preCreateActiveEffect")(elsewhere);

			expect(onHero.updateSource).not.toHaveBeenCalled();
			expect(elsewhere.updateSource).not.toHaveBeenCalled();
		});

		it("is left alone while the camp is still being set up, or when there is none", () => {
			const effect = added();
			canvas.scene = fakeScene({
				camping: activeSession({ phase: "setup" }),
			});
			hook("preCreateActiveEffect")(effect);
			canvas.scene = fakeScene();
			hook("preCreateActiveEffect")(effect);

			expect(effect.updateSource).not.toHaveBeenCalled();
		});

		it("keeps a stamp it already carries", () => {
			canvas.scene = fakeScene({ camping: activeSession() });
			const effect = added({ getFlag: () => "camp-other" });

			hook("preCreateActiveEffect")(effect);

			expect(effect.updateSource).not.toHaveBeenCalled();
		});
	});

	describe("Pack Up", () => {
		beforeEach(() => {
			vi.spyOn(foundry.applications.api.DialogV2, "confirm").mockResolvedValue(
				true,
			);
			getCampingHeroes.mockReturnValue([]);
			buildThreatsContext.mockReturnValue([]);
			buildOperations.mockReturnValue({ operations: {}, recap: {} });
			applyOperations.mockResolvedValue(undefined);
		});

		it("deletes this camp's tags and leaves the table's and another camp's alone", async () => {
			pack = new Map(
				[
					packEffect("campsite", "camp-1"),
					packEffect("added-in-camp", "camp-1"),
					packEffect("other-camp", "camp-2"),
					packEffect("scene-tag"),
					{ id: "legacy-no-flags" },
				].map((e) => [e.id, e]),
			);
			const scene = fakeScene({ camping: activeSession() });
			canvas.scene = scene;

			await actions["pack-up"]();

			expect(ContentSources.deleteStoryTags).toHaveBeenCalledTimes(1);
			expect(ContentSources.deleteStoryTags).toHaveBeenCalledWith([
				"campsite",
				"added-in-camp",
			]);
			expect([...pack.keys()]).toEqual([
				"other-camp",
				"scene-tag",
				"legacy-no-flags",
			]);
		});

		it("sweeps before it applies the camp's results", async () => {
			pack = new Map([["campsite", packEffect("campsite", "camp-1")]]);
			canvas.scene = fakeScene({ camping: activeSession() });
			let sweptBeforeApply;
			applyOperations.mockImplementation(async () => {
				sweptBeforeApply = ContentSources.deleteStoryTags.mock.calls.length;
			});

			await actions["pack-up"]();

			expect(sweptBeforeApply).toBe(1);
		});

		it("deletes nothing when no tag carries this camp's stamp", async () => {
			pack = new Map([["other-camp", packEffect("other-camp", "camp-2")]]);
			canvas.scene = fakeScene({ camping: activeSession() });

			await actions["pack-up"]();

			expect(ContentSources.deleteStoryTags).not.toHaveBeenCalled();
			expect(applyOperations).toHaveBeenCalledTimes(1);
		});

		it("deletes nothing for a session that has no campId to sweep by", async () => {
			pack = new Map([["unstamped", packEffect("unstamped", "")]]);
			canvas.scene = fakeScene({ camping: activeSession({ campId: "" }) });

			await actions["pack-up"]();

			expect(ContentSources.getStoryTags).not.toHaveBeenCalled();
			expect(ContentSources.deleteStoryTags).not.toHaveBeenCalled();
		});

		it("hands the camp's threats to the recap", async () => {
			const threats = [{ id: "v1", name: "Heavy Rain" }];
			buildThreatsContext.mockReturnValue(threats);
			const state = activeSession();
			state.placeOfStay.threats = ["v1"];
			canvas.scene = fakeScene({ camping: state });
			game.settings.get.mockImplementation((_scope, key) =>
				key === "show_camping_threats" ? true : undefined,
			);

			await actions["pack-up"]();

			expect(buildOperations.mock.calls[0][1].threatItems).toBe(threats);
			game.settings.get.mockReset();
		});

		// The setting hides the Threats section "during camps and sojourns". A
		// threat picked before the table turned it off must not surface in
		// the public recap either.
		it("leaves threats out of the recap when the Threats section is off", async () => {
			buildThreatsContext.mockReturnValue([{ id: "v1", name: "Heavy Rain" }]);
			const state = activeSession();
			state.placeOfStay.threats = ["v1"];
			canvas.scene = fakeScene({ camping: state });
			game.settings.get.mockImplementation((_scope, key) =>
				key === "show_camping_threats" ? false : undefined,
			);

			try {
				await actions["pack-up"]();
				expect(buildOperations.mock.calls[0][1].threatItems).toEqual([]);
			} finally {
				game.settings.get.mockReset();
			}
		});
	});

	// Core Book p.181: a sojourn's length adds Power to its camp actions.
	describe("launching a camp action roll", () => {
		function heroWithDialog() {
			const dialog = {
				setCampAction: vi.fn(),
				rendered: false,
				render: vi.fn(),
			};
			const sheet = { rollDialogInstance: dialog, renderRollDialog: vi.fn() };
			game.actors.get = vi.fn((id) => (id === "hero-1" ? { sheet } : null));
			return { dialog, sheet };
		}

		const launch = () =>
			actions["launch-camp-roll"](null, { dataset: { heroId: "hero-1" } });

		it.each([
			["camp", "days", 0],
			["sojourn", "days", 1],
			["sojourn", "weeks", 2],
			["sojourn", "months", 3],
		])("a %s of %s gives the roll +%i", (type, sojournDuration, bonus) => {
			canvas.scene = fakeScene({
				camping: activeSession({ type, sojournDuration }),
			});
			const { dialog, sheet } = heroWithDialog();

			launch();

			expect(dialog.setCampAction).toHaveBeenCalledWith({
				sojournBonus: bonus,
			});
			expect(sheet.renderRollDialog).toHaveBeenCalledTimes(1);
		});

		it("does nothing for a hero that is gone", () => {
			canvas.scene = fakeScene({ camping: activeSession() });
			const { dialog } = heroWithDialog();

			actions["launch-camp-roll"](null, { dataset: { heroId: "nobody" } });

			expect(dialog.setCampAction).not.toHaveBeenCalled();
		});
	});
});
