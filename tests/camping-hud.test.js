import { afterEach, describe, expect, it, vi } from "vitest";
import {
	CampingHud,
	campSceneLabel,
	shouldShowCampPickup,
} from "../modules/hud/camping-hud.js";

vi.mock("../modules/apps/roll/roll-dialog.js", () => ({
	LitmRollDialog: class {},
}));
vi.mock("../modules/apps/story-tags/scene-tag-dialog.js", () => ({
	SceneTagDialog: class {},
}));

import { registerUiHooks } from "../modules/system/hooks/ui-hooks.js";

describe("camp pickup", () => {
	it("offers a begun camp this client is not viewing", () => {
		expect(
			shouldShowCampPickup({ state: { phase: "active" }, rendered: false }),
		).toBe(true);
	});

	it.each([
		{ state: null, rendered: false },
		{ state: { phase: "setup" }, rendered: false },
		{ state: { phase: "active" }, rendered: true },
	])("stays hidden otherwise: %j", (args) => {
		expect(shouldShowCampPickup(args)).toBe(false);
	});
});

describe("camp scene label", () => {
	const scene = { name: "Simple Battle", navName: "Battle" };

	it.each([
		{ visible: true },
		{ active: true },
		{ isView: true },
	])("names a scene the user can see: %j", (seen) => {
		expect(campSceneLabel({ ...scene, ...seen })).toBe("Battle");
	});

	it("falls back to the scene name without a navigation name", () => {
		expect(campSceneLabel({ name: "Simple Battle", visible: true })).toBe(
			"Simple Battle",
		);
	});

	it("hides a map the user cannot see", () => {
		expect(campSceneLabel(scene)).toBe("");
		expect(campSceneLabel(null)).toBe("");
	});
});

describe("camping HUD lifecycle", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("survives a reload, hides while viewing, and clears when the camp ends", async () => {
		const listeners = new Map();
		vi.stubGlobal("Hooks", {
			on: (name, callback) => listeners.set(name, callback),
		});
		let onClick;
		const container = {
			classList: { add: vi.fn(), remove: vi.fn() },
			addEventListener: (_type, cb) => {
				onClick = cb;
			},
			innerHTML: "",
		};
		vi.stubGlobal("document", {
			getElementById: () => ({ prepend: vi.fn() }),
			createElement: () => container,
		});
		let camping = { phase: "active", type: "camp" };
		const scene = {
			id: "scene1",
			name: "Riverbank",
			visible: true,
			getFlag: () => camping,
		};
		vi.stubGlobal("foundry", {
			...foundry,
			utils: { hasProperty: (o, p) => p.split(".").every((k) => (o = o?.[k])) },
			applications: {
				...foundry.applications,
				handlebars: {
					renderTemplate: async (_path, { entries }) =>
						entries.map((e) => `${e.sceneId}:${e.title}@${e.sceneName}`).join(),
				},
			},
		});
		const campApp = { instance: null, open: vi.fn() };
		const hud = new CampingHud();
		vi.stubGlobal("game", {
			...game,
			i18n: { localize: (k) => k, format: (k) => k },
			scenes: [scene],
			litmv2: { campingHud: hud, LitmCampingScene: campApp },
		});
		registerUiHooks();

		await hud.render();
		expect(container.innerHTML).toBe("scene1:LITM.Ui.camping_camp@Riverbank");

		onClick({
			target: { closest: () => ({ dataset: { sceneId: "scene1" } }) },
		});
		expect(campApp.open).toHaveBeenCalledWith({ sceneId: "scene1" });

		campApp.instance = { rendered: true };
		campApp.sceneId = "other-scene";
		await listeners.get("renderLitmCampingScene")();
		expect(container.innerHTML).toBe("scene1:LITM.Ui.camping_camp@Riverbank");

		campApp.sceneId = "scene1";
		await listeners.get("renderLitmCampingScene")();
		expect(container.innerHTML).toBe("");

		campApp.instance = null;
		await listeners.get("closeLitmCampingScene")();
		expect(container.innerHTML).toBe("scene1:LITM.Ui.camping_camp@Riverbank");

		// A player who cannot see the map still gets the entry, not its name.
		scene.visible = false;
		await listeners.get("updateScene")(scene, { flags: { litmv2: {} } });
		expect(container.innerHTML).toBe("scene1:LITM.Ui.camping_camp@");

		camping = undefined;
		await listeners.get("updateScene")(scene, {
			flags: { litmv2: { "-=camping": null } },
		});
		expect(container.innerHTML).toBe("");
	});
});
