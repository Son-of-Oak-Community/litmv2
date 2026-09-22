import { afterEach, describe, expect, it, vi } from "vitest";
import {
	RollDialogHud,
	shouldShowRollPickup,
} from "../modules/hud/roll-dialog-hud.js";

vi.mock("../modules/apps/roll/roll-dialog.js", () => ({
	LitmRollDialog: class {},
}));
vi.mock("../modules/apps/story-tags/scene-tag-dialog.js", () => ({
	SceneTagDialog: class {},
}));

import { registerUiHooks } from "../modules/system/hooks/ui-hooks.js";

describe("roll pickup", () => {
	const shared = {
		flag: { ownerId: "roller", narrator: true },
		userId: "helper",
		ownerActive: true,
		rendered: false,
	};

	it.each([
		"narrator",
		"participant",
		"helper",
	])("hides an open %s view and restores pickup after it closes", (userId) => {
		expect(shouldShowRollPickup({ ...shared, userId, rendered: true })).toBe(
			false,
		);
		expect(shouldShowRollPickup({ ...shared, userId })).toBe(true);
	});

	it.each([
		{ flag: null },
		{ userId: "roller" },
		{ ownerActive: false },
		{ flag: { ownerId: "roller", type: "sacrifice" } },
	])("does not advertise unavailable or separately handled rolls: %j", (change) => {
		expect(shouldShowRollPickup({ ...shared, ...change })).toBe(false);
	});
});

describe("HUD lifecycle", () => {
	afterEach(() => vi.unstubAllGlobals());

	it("refreshes on local render/close without needing an actor flag update", async () => {
		const listeners = new Map();
		vi.stubGlobal("Hooks", {
			on: (name, callback) => listeners.set(name, callback),
		});
		const container = {
			classList: { add: vi.fn(), remove: vi.fn() },
			addEventListener: vi.fn(),
			innerHTML: "",
		};
		const panel = { prepend: vi.fn() };
		vi.stubGlobal("document", {
			getElementById: () => panel,
			createElement: () => container,
		});
		const flag = { ownerId: "gm", narrator: true };
		const actor = {
			id: "fellowship",
			name: "Fellowship",
			img: "fellowship.webp",
			getFlag: () => flag,
		};
		const dialog = { rendered: false };
		const template = vi.fn(async (_path, { entries }) =>
			entries.map((entry) => entry.actorName).join(),
		);
		vi.stubGlobal("foundry", {
			...foundry,
			applications: {
				...foundry.applications,
				instances: new Map([["litm-roll-dialog-fellowship", dialog]]),
				handlebars: { renderTemplate: template },
			},
		});
		const hud = new RollDialogHud();
		vi.stubGlobal("game", {
			...game,
			user: { id: "participant" },
			users: new Map([["gm", { active: true, name: "Narrator" }]]),
			actors: [actor],
			litmv2: { rollDialogHud: hud },
		});
		registerUiHooks();
		await hud.render();
		expect(container.innerHTML).toBe("Fellowship");
		dialog.rendered = true;
		await listeners.get("litm.rollDialogRendered")();
		expect(container.innerHTML).toBe("");
		dialog.rendered = false;
		await listeners.get("litm.rollDialogClosed")();
		expect(container.innerHTML).toBe("Fellowship");
		expect(actor.getFlag()).toBe(flag);
	});
});
