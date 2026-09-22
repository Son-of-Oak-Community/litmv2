import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import tourData from "../tours/narrators-call.json";

vi.mock("../modules/system/settings.js", () => ({ LitmSettings: {} }));
vi.mock("../modules/system/sample-hero.js", () => ({
	createSampleHero: vi.fn(),
}));

describe("Narrator tour preview", () => {
	let tour;
	let preview;
	let hero;
	let create;

	beforeEach(async () => {
		vi.resetModules();
		class Tour {
			async _preStep() {}
			async _postStep() {}
			exit() {}
		}
		vi.stubGlobal("foundry", {
			...foundry,
			nue: { Tour },
			applications: { ...foundry.applications, instances: new Map() },
		});
		preview = {
			configureSharedRoll: vi.fn(),
			render: vi.fn(),
			close: vi.fn(),
		};
		create = vi.fn(() => preview);
		hero = {
			id: "sample",
			unsetFlag: vi.fn(),
			sheet: {
				hasRollDialog: true,
				rollDialogInstance: { rendered: true, close: vi.fn() },
			},
		};
		vi.stubGlobal("game", {
			...game,
			user: { id: "gm", name: "Narrator", isGM: true },
			actors: new Map([[hero.id, hero]]),
			litmv2: { LitmRollDialog: { create } },
		});
		const { LitmTour } = await import("../modules/system/tours.js");
		tour = new LitmTour();
		tour.targetActor = hero;
		tour.currentStep = { action: "openCalledRoll" };
	});

	afterEach(() => vi.unstubAllGlobals());

	it("uses a private preview even when the target actor has a live roll", async () => {
		await tour._preStep();
		expect(create).toHaveBeenCalledWith({
			id: "litm-roll-tour-preview",
			actorId: hero.id,
			ownerId: "gm",
			localOnly: true,
		});
		expect(preview.configureSharedRoll).toHaveBeenCalledWith({
			ownerId: "gm",
			narratorUserId: "gm",
			narratorName: "Narrator",
		});
		expect(preview.render).toHaveBeenCalledWith(true);
		await tour._preStep();
		expect(create).toHaveBeenCalledTimes(1);
	});

	it("targets the private preview rather than any rendered live roll", async () => {
		await tour._preStep();
		const { id } = create.mock.calls[0][0];
		const dialogSteps = tourData.steps.filter((step) =>
			step.selector.includes(".litm--roll-dialog-"),
		);
		expect(dialogSteps).toHaveLength(4);
		for (const step of dialogSteps)
			expect(step.selector.startsWith(`#${id} `)).toBe(true);
	});

	it("cleans up only its preview, without clearing a live roll's presence", async () => {
		await tour._preStep();
		tour.hasNext = false;
		await tour._postStep();
		await tour._postStep();
		expect(preview.close).toHaveBeenCalledTimes(1);
		expect(hero.sheet.rollDialogInstance.close).not.toHaveBeenCalled();
		expect(hero.unsetFlag).not.toHaveBeenCalled();
	});

	it("closes its preview on exit as well as completion", async () => {
		await tour._preStep();
		tour.exit();
		await vi.waitFor(() => expect(preview.close).toHaveBeenCalledTimes(1));
		expect(hero.sheet.rollDialogInstance.close).not.toHaveBeenCalled();
		expect(hero.unsetFlag).not.toHaveBeenCalled();
	});
});
