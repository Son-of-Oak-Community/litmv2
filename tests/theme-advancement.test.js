import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	improveOptions,
	ThemeAdvancementApp,
} from "../modules/apps/theme-advancement.js";
import { ThemeData } from "../modules/item/theme/theme-data.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

// Core Book p.193: the third Improve gives one improvement, and a tag may be
// rewritten along with it.

const originalUx = foundry.applications.ux;

function setup({ fellowship = false, promise = 0, tracks = {} } = {}) {
	const actor = fakeActor({ type: "hero", system: { promise, pendingPromise: 0 } });
	const effects = [
		fakeEffect({ type: "power_tag", name: "Title", system: { isTitleTag: true } }),
		fakeEffect({ type: "power_tag", name: "Swift", system: {} }),
		fakeEffect({ type: "power_tag", name: "Keen", system: {} }),
		fakeEffect({ type: "weakness_tag", name: "Restless", system: {} }),
	];
	const theme = fakeItem({ type: "theme", name: "Wanderer", parent: actor, effects });
	theme.system = new ThemeData({
		isFellowship: fellowship,
		nascentImprovements: 0,
		nascentPending: 0,
		improve: { value: 3 },
		quest: {
			tracks: {
				abandon: { value: tracks.abandon ?? 0 },
				milestone: { value: tracks.milestone ?? 0 },
			},
		},
		specialImprovements: [],
	});
	theme.system.parent = theme;
	theme.actor = actor;
	theme.update = vi.fn(async () => {});
	theme.createEmbeddedDocuments = vi.fn(async () => []);
	theme.updateEmbeddedDocuments = vi.fn(async () => []);
	theme.deleteEmbeddedDocuments = vi.fn(async () => []);
	actor.items = Object.assign([theme], { get: () => theme });
	game.actors.get = vi.fn(() => actor);
	return { actor, theme };
}

async function confirm(theme, actor, form) {
	foundry.applications.ux = {
		FormDataExtended: class {
			object = form;
		},
	};
	const app = new ThemeAdvancementApp({ actorId: actor.id, themeId: theme.id });
	app.close = vi.fn();
	await ThemeAdvancementApp.DEFAULT_OPTIONS.actions.confirm.call(app);
	return app;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
	foundry.applications.ux = originalUx;
});

describe("improveOptions", () => {
	it("offers every improvement to a hero theme", () => {
		const { theme } = setup();
		expect(improveOptions(theme, { hasSpecials: true })).toEqual([
			"power",
			"weakness",
			"special",
			"reset",
			"promise",
		]);
	});

	it("never offers Promise to the Fellowship theme", () => {
		const { theme } = setup({ fellowship: true });
		expect(improveOptions(theme, { hasSpecials: false })).toEqual([
			"power",
			"weakness",
			"reset",
		]);
	});
});

describe("choosing an improvement", () => {
	it("removes a weakness tag and spends the Improve", async () => {
		const { actor, theme } = setup();
		const weakness = theme.effects.find((e) => e.type === "weakness_tag");
		const app = await confirm(theme, actor, {
			option: "weakness",
			removeWeakness: weakness.id,
		});
		expect(theme.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			weakness.id,
		]);
		expect(theme.update).toHaveBeenCalledWith({ "system.improve.value": 0 });
		expect(app.close).toHaveBeenCalled();
	});

	it("refuses two weakness changes at once", async () => {
		const { actor, theme } = setup();
		const weakness = theme.effects.find((e) => e.type === "weakness_tag");
		await confirm(theme, actor, {
			option: "weakness",
			weaknessName: "Proud",
			removeWeakness: weakness.id,
		});
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.improve_choose_weakness",
		);
		expect(theme.update).not.toHaveBeenCalled();
	});

	it("resets only the chosen tracks", async () => {
		const { actor, theme } = setup({ tracks: { abandon: 2, milestone: 1 } });
		await confirm(theme, actor, { option: "reset", resetMilestone: true });
		expect(theme.update).toHaveBeenCalledWith({
			"system.quest.tracks.milestone.value": 0,
			"system.improve.value": 0,
		});
	});

	it("asks which track to reset", async () => {
		const { actor, theme } = setup();
		await confirm(theme, actor, { option: "reset" });
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.improve_choose_reset",
		);
		expect(theme.update).not.toHaveBeenCalled();
	});

	it("marks one Promise on the Hero", async () => {
		const { actor, theme } = setup({ promise: 2 });
		await confirm(theme, actor, { option: "promise" });
		expect(actor.update).toHaveBeenCalledWith({ "system.promise": 3 });
		expect(theme.update).toHaveBeenCalledWith({ "system.improve.value": 0 });
	});

	it("marks no Promise for the Fellowship theme", async () => {
		const { actor, theme } = setup({ fellowship: true });
		await confirm(theme, actor, { option: "promise" });
		expect(actor.update).not.toHaveBeenCalled();
		expect(theme.update).not.toHaveBeenCalled();
	});

	it("rewrites one tag along with the improvement", async () => {
		const { actor, theme } = setup();
		const swift = theme.effects.find((e) => e.name === "Swift");
		await confirm(theme, actor, {
			option: "promise",
			rewriteTag: swift.id,
			rewriteName: "Fleet",
		});
		expect(theme.updateEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			{ _id: swift.id, name: "Fleet" },
		]);
	});

	it("refuses to blank the tag it rewrites", async () => {
		const { actor, theme } = setup();
		const swift = theme.effects.find((e) => e.name === "Swift");
		await confirm(theme, actor, {
			option: "promise",
			rewriteTag: swift.id,
			rewriteName: " ",
		});
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.improve_rewrite_name",
		);
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("rewrites the title tag by renaming the theme", async () => {
		const { actor, theme } = setup();
		const title = theme.effects.find((e) => e.system.isTitleTag);
		await confirm(theme, actor, {
			option: "promise",
			rewriteTag: title.id,
			rewriteName: "Pathfinder",
		});
		expect(theme.updateEmbeddedDocuments).not.toHaveBeenCalled();
		expect(theme.update).toHaveBeenCalledWith({
			name: "Pathfinder",
			"system.improve.value": 0,
		});
	});

	it("refuses to rewrite the weakness tag it removes", async () => {
		const { actor, theme } = setup();
		const weakness = theme.effects.find((e) => e.type === "weakness_tag");
		await confirm(theme, actor, {
			option: "weakness",
			removeWeakness: weakness.id,
			rewriteTag: weakness.id,
			rewriteName: "Calm",
		});
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.improve_rewrite_removed",
		);
		expect(theme.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(theme.update).not.toHaveBeenCalled();
	});

	it("asks which tag new wording is for", async () => {
		const { actor, theme } = setup();
		await confirm(theme, actor, { option: "promise", rewriteName: "Fleet" });
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.improve_rewrite_pick_tag",
		);
		expect(actor.update).not.toHaveBeenCalled();
	});

	it("applies one improvement for a double click", async () => {
		const { actor, theme } = setup({ promise: 1 });
		foundry.applications.ux = {
			FormDataExtended: class {
				object = { option: "promise" };
			},
		};
		const app = new ThemeAdvancementApp({ actorId: actor.id, themeId: theme.id });
		app.close = vi.fn();
		const button = { disabled: false, isConnected: true };
		const { confirm: onConfirm } = ThemeAdvancementApp.DEFAULT_OPTIONS.actions;
		await Promise.all([
			onConfirm.call(app, {}, button),
			onConfirm.call(app, {}, button),
		]);
		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(button.disabled).toBe(false);
	});

	it("does nothing before the Improve track is full", async () => {
		const { actor, theme } = setup();
		theme.system.improve.value = 2;
		await confirm(theme, actor, { option: "promise" });
		expect(actor.update).not.toHaveBeenCalled();
	});
});

describe("the improvement choices", () => {
	const themebook = {
		type: "themebook",
		name: "Book",
		system: {
			specialImprovements: [
				{ name: "Keen Eye", description: "See more." },
				{ name: "Light Step", description: "Move quietly." },
			],
			powerTagQuestions: [],
			weaknessTagQuestions: [],
		},
	};

	beforeEach(() => {
		game.items = [themebook];
	});
	afterEach(() => {
		delete game.items;
	});

	function bookTheme() {
		const { actor, theme } = setup();
		theme.system.themebook = "Book";
		theme.system.specialImprovements = [
			{ name: "Keen Eye", description: "See more.", isActive: true },
		];
		return { actor, theme };
	}

	// A scratched tag is still gained; activating it would spend the Improve
	// on nothing.
	it("offers only disabled tags to activate, never scratched ones", async () => {
		const { actor, theme } = bookTheme();
		const [swift, keen] = theme.effects.filter(
			(e) => e.type === "power_tag" && !e.system.isTitleTag,
		);
		swift.system.isScratched = true;
		swift.active = false;
		keen.disabled = true;
		keen.active = false;
		const app = new ThemeAdvancementApp({ actorId: actor.id, themeId: theme.id });
		const context = await app._prepareContext();
		expect(context.inactivePowerTags.map((o) => o.value)).toEqual([keen.id]);
	});

	it("adds a themebook Special Improvement the theme lacks, once", async () => {
		const { actor, theme } = bookTheme();
		const app = new ThemeAdvancementApp({ actorId: actor.id, themeId: theme.id });
		app.close = vi.fn();
		const context = await app._prepareContext();
		expect(context.specialImprovementOptions.map((o) => o.label)).toEqual([
			"Light Step",
		]);
		foundry.applications.ux = {
			FormDataExtended: class {
				object = { option: "special", special: "1" };
			},
		};
		await ThemeAdvancementApp.DEFAULT_OPTIONS.actions.confirm.call(app);
		expect(theme.update).toHaveBeenCalledWith({
			"system.specialImprovements": [
				{ name: "Keen Eye", description: "See more.", isActive: true },
				{ name: "Light Step", description: "Move quietly.", isActive: true },
			],
			"system.improve.value": 0,
		});
	});

	it("never takes a Special Improvement twice", async () => {
		const { actor, theme } = bookTheme();
		const app = new ThemeAdvancementApp({ actorId: actor.id, themeId: theme.id });
		await app._prepareContext();
		foundry.applications.ux = {
			FormDataExtended: class {
				object = { option: "special", special: "0" };
			},
		};
		await ThemeAdvancementApp.DEFAULT_OPTIONS.actions.confirm.call(app);
		expect(theme.update).not.toHaveBeenCalled();
		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.improve_choose_special",
		);
	});
});
