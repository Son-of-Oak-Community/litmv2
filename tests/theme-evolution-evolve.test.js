import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyPromiseToActor,
	ThemeEvolutionWizard,
} from "../modules/apps/theme-evolution.js";
import { fakeElement } from "./__helpers__/dom.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

// The wizard's Evolve and Expand paths (Core Book p.189-193).
// Evolve keeps the theme: a new title, a new themebook or Might, tags renamed
// or traded for Promise. Expand keeps it too and replaces another of the
// Hero's themes. (Replace and the drop path: theme-evolution-drop.test.js.)

const originalUx = foundry.applications.ux;

/**
 * A theme: its title tag, `power` more power tags, `weakness` weakness tags.
 * Effect ids are `<name>-p0`, `<name>-w0`, so a form can name them.
 */
function fakeTheme({
	name = "Wanderer",
	power = 2,
	weakness = 1,
	specials = [],
	isFellowship = false,
} = {}) {
	const effects = [
		fakeEffect({
			id: `${name}-title`,
			name: `${name} title`,
			type: "power_tag",
			system: { isTitleTag: true, question: "0" },
		}),
	];
	for (let i = 0; i < power; i++) {
		effects.push(
			fakeEffect({
				id: `${name}-p${i}`,
				name: `power ${i}`,
				type: "power_tag",
				system: { question: String(i + 1) },
			}),
		);
	}
	for (let i = 0; i < weakness; i++) {
		effects.push(
			fakeEffect({
				id: `${name}-w${i}`,
				name: `weakness ${i}`,
				type: "weakness_tag",
				system: { question: String(i) },
			}),
		);
	}
	const theme = fakeItem({ id: name, name, type: "theme", effects });
	theme.system = {
		isFellowship,
		themebook: "Old Book",
		level: "origin",
		quest: { description: "Old quest" },
		specialImprovements: specials,
	};
	theme.deleteEmbeddedDocuments = vi.fn(async (_type, ids) => {
		for (const id of ids) {
			const idx = theme.effects.findIndex((e) => e.id === id);
			if (idx >= 0) theme.effects.splice(idx, 1);
		}
		return [];
	});
	return theme;
}

/** A wizard on `theme`, owned by a Hero who also has `others`. */
function wizardOn(
	theme,
	{ others = [], promise = 0, pendingPromise = 0 } = {},
) {
	const actor = fakeActor({
		name: "Gerrin",
		system: { promise, pendingPromise },
	});
	const all = [theme, ...others];
	actor.items = Object.assign(all, {
		get: (id) => all.find((i) => i.id === id),
	});
	game.actors.get = vi.fn(() => actor);
	const wizard = new ThemeEvolutionWizard({
		actorId: actor.id,
		themeId: theme.id,
	});
	wizard.close = vi.fn();
	Object.defineProperty(wizard, "element", { value: fakeElement() });
	return { wizard, actor };
}

/** Press Confirm with `form` as the wizard's form data. */
async function confirm(wizard, form) {
	foundry.applications.ux = {
		...originalUx,
		FormDataExtended: class {
			object = form;
		},
	};
	await ThemeEvolutionWizard.DEFAULT_OPTIONS.actions.confirm.call(wizard);
}

/** An Evolve form: a new title and a new themebook. */
const evolveForm = (extra = {}) => ({
	mode: "evolve",
	name: "Pathfinder",
	themebook: "New Book",
	level: "origin",
	quest: "Find the way",
	...extra,
});

const themeAdvanced = () =>
	Hooks.callAll.mock.calls.find(([hook]) => hook === "litm.themeAdvanced");

beforeEach(() => {
	vi.clearAllMocks();
	game.user.isGM = false;
});

afterEach(() => {
	foundry.applications.ux = originalUx;
});

describe("Evolve: the theme carries on", () => {
	it("takes its new title, themebook and Quest, and resets both Quest tracks", async () => {
		const theme = fakeTheme();
		const { wizard } = wizardOn(theme);

		await confirm(wizard, evolveForm({ level: "adventure" }));

		expect(theme.update).toHaveBeenCalledTimes(1);
		expect(theme.update).toHaveBeenCalledWith({
			name: "Pathfinder",
			"system.themebook": "New Book",
			"system.level": "adventure",
			"system.quest.description": "Find the way",
			"system.quest.tracks.milestone.value": 0,
			"system.quest.tracks.abandon.value": 0,
			"system.specialImprovements": [],
		});
		expect(wizard.close).toHaveBeenCalled();
		await expect(wizard.done).resolves.toBe(true);
	});

	// The theme is the same one continuing: no nascent stage, and its
	// Improve track and its tags stay.
	it("is not a new theme: no nascent stage, Improve and tags untouched", async () => {
		const theme = fakeTheme();
		const { wizard } = wizardOn(theme);

		await confirm(wizard, evolveForm());

		const [update] = theme.update.mock.calls[0];
		expect(update).not.toHaveProperty("system.nascentImprovements");
		expect(update).not.toHaveProperty("system.nascentPending");
		expect(update).not.toHaveProperty("system.improve.value");
		expect(theme.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(theme.createEmbeddedDocuments).not.toHaveBeenCalled();
		expect(theme.effects).toHaveLength(4);
	});

	it("marks one Promise when nothing is traded", async () => {
		const theme = fakeTheme();
		const { wizard, actor } = wizardOn(theme, { promise: 1 });

		await confirm(wizard, evolveForm());

		expect(actor.update).toHaveBeenCalledWith({ "system.promise": 2 });
	});

	it("needs no weakness tag and no Quest, unlike a new theme", async () => {
		const theme = fakeTheme();
		const { wizard } = wizardOn(theme);

		await confirm(wizard, evolveForm({ quest: "", weakness: "" }));

		expect(ui.notifications.warn).not.toHaveBeenCalled();
		expect(theme.update).toHaveBeenCalledTimes(1);
	});

	it("says the theme evolved, and fires litm.themeAdvanced with the update", async () => {
		const theme = fakeTheme();
		const { wizard, actor } = wizardOn(theme);
		const format = vi.spyOn(game.i18n, "format");

		await confirm(wizard, evolveForm());

		const [, hookActor, hookTheme, payload] = themeAdvanced();
		expect(hookActor).toBe(actor);
		expect(hookTheme).toBe(theme);
		expect(payload).toMatchObject({
			name: "Pathfinder",
			"system.themebook": "New Book",
			litmEvolution: { mode: "evolve", promiseGained: 1, tradedCount: 0 },
		});
		expect(format).toHaveBeenCalledWith(
			"LITM.Ui.evolution_evolved_notification",
			{ theme: "Pathfinder", actor: "Gerrin" },
		);
		format.mockRestore();
	});
});

describe("Evolve: trading tags for Promise", () => {
	it("deletes the traded tags and marks one more Promise for each", async () => {
		const theme = fakeTheme({ power: 4, weakness: 2 });
		const { wizard, actor } = wizardOn(theme);

		await confirm(
			wizard,
			evolveForm({
				"trade-power-Wanderer-p3": true,
				"trade-weakness-Wanderer-w1": true,
			}),
		);

		expect(theme.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			"Wanderer-p3",
			"Wanderer-w1",
		]);
		expect(actor.update).toHaveBeenCalledWith({ "system.promise": 3 });
		expect(themeAdvanced()[3].litmEvolution).toEqual({
			mode: "evolve",
			promiseGained: 3,
			tradedCount: 2,
		});
	});

	it("leaves an unticked tag where it is", async () => {
		const theme = fakeTheme({ power: 3 });
		const { wizard } = wizardOn(theme);

		await confirm(wizard, evolveForm({ "trade-power-Wanderer-p2": false }));

		expect(theme.deleteEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("never trades the title tag, whatever the form says", async () => {
		const theme = fakeTheme();
		const { wizard, actor } = wizardOn(theme);

		await confirm(wizard, evolveForm({ "trade-power-Wanderer-title": true }));

		expect(theme.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(actor.update).toHaveBeenCalledWith({ "system.promise": 1 });
	});

	// A Special Improvement is named by its place in the stored list.
	it("drops a traded Special Improvement and keeps the others in order", async () => {
		const specials = [
			{ name: "Keen Eye", isActive: true },
			{ name: "Not gained", isActive: false },
			{ name: "Light Step", isActive: true },
		];
		const theme = fakeTheme({ specials });
		const { wizard, actor } = wizardOn(theme);

		await confirm(wizard, evolveForm({ "trade-special-2": true }));

		expect(theme.update.mock.calls[0][0]["system.specialImprovements"]).toEqual(
			[
				{ name: "Keen Eye", isActive: true },
				{ name: "Not gained", isActive: false },
			],
		);
		expect(theme.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(actor.update).toHaveBeenCalledWith({ "system.promise": 2 });
	});

	it("marks no Promise for the Fellowship theme, traded tags or not", async () => {
		const theme = fakeTheme({ power: 3, isFellowship: true });
		const { wizard, actor } = wizardOn(theme);

		await confirm(wizard, evolveForm({ "trade-power-Wanderer-p2": true }));

		expect(theme.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			"Wanderer-p2",
		]);
		expect(actor.update).not.toHaveBeenCalled();
		expect(themeAdvanced()[3].litmEvolution.promiseGained).toBe(0);
	});
});

describe("Evolve: revising the tags that stay", () => {
	it("renames a kept tag", async () => {
		const theme = fakeTheme();
		const { wizard } = wizardOn(theme);

		await confirm(
			wizard,
			evolveForm({
				themebook: "Old Book",
				level: "adventure",
				"rename-power-Wanderer-p0": " Fleet of foot ",
				"rename-weakness-Wanderer-w0": "Restless",
			}),
		);

		expect(theme.updateEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			{ _id: "Wanderer-p0", name: "Fleet of foot" },
			{ _id: "Wanderer-w0", name: "Restless" },
		]);
	});

	it("leaves a tag whose name was not changed, or was blanked, alone", async () => {
		const theme = fakeTheme();
		const { wizard } = wizardOn(theme);

		await confirm(
			wizard,
			evolveForm({
				themebook: "Old Book",
				level: "adventure",
				"rename-power-Wanderer-p0": "power 0",
				"rename-power-Wanderer-p1": "  ",
			}),
		);

		expect(theme.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("does not rename a tag that is traded away", async () => {
		const theme = fakeTheme({ power: 3 });
		const { wizard } = wizardOn(theme);

		await confirm(
			wizard,
			evolveForm({
				themebook: "Old Book",
				level: "adventure",
				"trade-power-Wanderer-p2": true,
				"rename-power-Wanderer-p2": "Gone",
			}),
		);

		expect(theme.updateEmbeddedDocuments).not.toHaveBeenCalled();
		expect(theme.deleteEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			"Wanderer-p2",
		]);
	});

	it("renames a kept Special Improvement by its place in the list", async () => {
		const specials = [
			{ name: "Not gained", isActive: false },
			{ name: "Keen Eye", isActive: true, description: "See more." },
		];
		const theme = fakeTheme({ specials });
		const { wizard } = wizardOn(theme);

		await confirm(wizard, evolveForm({ "rename-special-1": "Hawk Eye" }));

		expect(theme.update.mock.calls[0][0]["system.specialImprovements"]).toEqual(
			[
				{ name: "Not gained", isActive: false },
				{ name: "Hawk Eye", isActive: true, description: "See more." },
			],
		);
	});

	// The kept tags answered the old themebook's questions; the answers stay,
	// the question numbers no longer mean anything.
	it("clears the question of every kept tag when the themebook changes", async () => {
		const theme = fakeTheme({ power: 3 });
		const { wizard } = wizardOn(theme);

		await confirm(
			wizard,
			evolveForm({
				"trade-power-Wanderer-p2": true,
				"rename-power-Wanderer-p0": "Fleet",
			}),
		);

		expect(theme.updateEmbeddedDocuments).toHaveBeenCalledWith("ActiveEffect", [
			{ _id: "Wanderer-p0", name: "Fleet", "system.question": null },
			{ _id: "Wanderer-p1", "system.question": null },
			{ _id: "Wanderer-w0", "system.question": null },
		]);
	});

	it("keeps the questions when only the Might changes", async () => {
		const theme = fakeTheme();
		const { wizard } = wizardOn(theme);

		await confirm(
			wizard,
			evolveForm({ themebook: "Old Book", level: "adventure" }),
		);

		expect(theme.updateEmbeddedDocuments).not.toHaveBeenCalled();
	});

	it("revises the kept tags before it deletes the traded ones", async () => {
		const theme = fakeTheme({ power: 3 });
		const { wizard } = wizardOn(theme);

		await confirm(wizard, evolveForm({ "trade-power-Wanderer-p2": true }));

		expect(
			theme.updateEmbeddedDocuments.mock.invocationCallOrder[0],
		).toBeLessThan(theme.deleteEmbeddedDocuments.mock.invocationCallOrder[0]);
		expect(
			theme.deleteEmbeddedDocuments.mock.invocationCallOrder[0],
		).toBeLessThan(theme.update.mock.invocationCallOrder[0]);
	});
});

describe("Evolve: what it refuses", () => {
	const refused = async (form, warning) => {
		const theme = fakeTheme();
		const { wizard, actor } = wizardOn(theme);

		await confirm(wizard, form);

		expect(ui.notifications.warn).toHaveBeenCalledWith(warning);
		expect(theme.update).not.toHaveBeenCalled();
		expect(theme.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(actor.update).not.toHaveBeenCalled();
		expect(Hooks.callAll).not.toHaveBeenCalled();
		expect(wizard.close).not.toHaveBeenCalled();
		// The wizard can be confirmed again once the form is put right.
		expect(wizard._submitting).toBe(false);
	};

	it("a blank title", () =>
		refused(evolveForm({ name: "  " }), "LITM.Ui.evolution_name_required"));

	it("the title it already has, whatever its case", () =>
		refused(
			evolveForm({ name: "WANDERER" }),
			"LITM.Ui.evolution_title_must_change",
		));

	it("the same themebook and the same Might", () =>
		refused(
			evolveForm({ themebook: "Old Book", level: "origin" }),
			"LITM.Ui.evolution_must_change",
		));
});

describe("Expand: the theme stays and another is replaced", () => {
	const expandForm = (extra = {}) => ({
		mode: "expand",
		expandTarget: "Drifter",
		thisQuest: "A new road",
		name: "Pathfinder",
		themebook: "New Book",
		level: "adventure",
		quest: "Find the way",
		weakness: "Reckless",
		...extra,
	});

	const setup = (targetShape = {}) => {
		const theme = fakeTheme();
		const target = fakeTheme({ name: "Drifter", ...targetShape });
		const { wizard, actor } = wizardOn(theme, { others: [target] });
		return { theme, target, wizard, actor };
	};

	it("resets the theme's Milestone, rewrites its Quest and keeps the rest", async () => {
		const { theme, wizard } = setup();

		await confirm(wizard, expandForm());

		expect(theme.update).toHaveBeenCalledTimes(1);
		expect(theme.update).toHaveBeenCalledWith({
			"system.quest.tracks.milestone.value": 0,
			"system.quest.description": "A new road",
		});
		expect(theme.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(theme.effects).toHaveLength(4);
	});

	it("replaces the chosen theme with a nascent one", async () => {
		const { target, wizard } = setup({ power: 3, weakness: 2 });

		await confirm(wizard, expandForm());

		expect(target.update).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "Pathfinder",
				"system.themebook": "New Book",
				"system.level": "adventure",
				"system.quest.description": "Find the way",
				"system.specialImprovements": [],
				"system.nascentImprovements": 2,
				"system.nascentPending": 0,
			}),
		);
		// Only its title tag is left, and the one new weakness tag is added.
		expect(target.effects.map((e) => e.id)).toEqual(["Drifter-title"]);
		const [, created] = target.createEmbeddedDocuments.mock.calls.at(-1);
		expect(created).toEqual([
			expect.objectContaining({ type: "weakness_tag", name: "Reckless" }),
		]);
		await expect(wizard.done).resolves.toBe(true);
		expect(wizard.close).toHaveBeenCalled();
	});

	// p.192: Promise comes from the theme that is replaced.
	it.each([
		["a baseline theme", { power: 2, weakness: 1 }, 1],
		["a power tag beyond the third", { power: 3, weakness: 1 }, 2],
		[
			"every kind of extra",
			{
				power: 4,
				weakness: 2,
				specials: [{ name: "Keen Eye", isActive: true }],
			},
			5,
		],
	])("marks Promise for %s being replaced", async (_label, shape, promise) => {
		const { wizard, actor } = setup(shape);

		await confirm(wizard, expandForm());

		expect(actor.update).toHaveBeenCalledTimes(1);
		expect(actor.update).toHaveBeenCalledWith({ "system.promise": promise });
	});

	it("counts no Promise from the theme that expands", async () => {
		const theme = fakeTheme({ power: 5, weakness: 3 });
		const target = fakeTheme({ name: "Drifter" });
		const { wizard, actor } = wizardOn(theme, { others: [target] });

		await confirm(wizard, expandForm());

		expect(actor.update).toHaveBeenCalledWith({ "system.promise": 1 });
	});

	it.each([
		[
			"no theme to replace",
			{ expandTarget: "" },
			"LITM.Ui.evolution_expand_target_required",
		],
		[
			"a theme the Hero does not have",
			{ expandTarget: "nowhere" },
			"LITM.Ui.evolution_expand_target_required",
		],
		[
			"the replaced theme's own title",
			{ name: "drifter" },
			"LITM.Ui.evolution_title_must_change",
		],
		[
			"no new Quest for the theme that stays",
			{ thisQuest: "  " },
			"LITM.Ui.evolution_expand_quest_required",
		],
		[
			"no weakness tag for the new theme",
			{ weakness: "" },
			"LITM.Ui.evolution_weakness_required",
		],
		[
			"no Quest for the new theme",
			{ quest: " " },
			"LITM.Ui.evolution_quest_required",
		],
	])("refuses %s and changes nothing", async (_label, blank, warning) => {
		const { theme, target, wizard, actor } = setup();

		await confirm(wizard, expandForm(blank));

		expect(ui.notifications.warn).toHaveBeenCalledWith(warning);
		expect(theme.update).not.toHaveBeenCalled();
		expect(target.update).not.toHaveBeenCalled();
		expect(target.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(actor.update).not.toHaveBeenCalled();
		expect(wizard.close).not.toHaveBeenCalled();
	});
});

// p.193: at 5 Promise the Hero has a Moment of Fulfillment; what is left over
// is marked once the track is reset. It waits in `pendingPromise`.
describe("applyPromiseToActor", () => {
	const hero = (promise, pendingPromise = 0) =>
		fakeActor({ name: "Gerrin", system: { promise, pendingPromise } });

	const trackCompleted = () =>
		Hooks.callAll.mock.calls.filter(([hook]) => hook === "litm.trackCompleted");

	it("marks Promise below the full track and says nothing", async () => {
		const actor = hero(1);

		await applyPromiseToActor(actor, 2);

		expect(actor.update).toHaveBeenCalledWith({ "system.promise": 3 });
		expect(trackCompleted()).toHaveLength(0);
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
	});

	it("announces the track completed when it reaches 5, and banks the rest", async () => {
		const actor = hero(4);

		await applyPromiseToActor(actor, 3);

		expect(actor.update).toHaveBeenCalledWith({
			"system.promise": 5,
			"system.pendingPromise": 2,
		});
		expect(trackCompleted()).toHaveLength(1);
		expect(trackCompleted()[0][1]).toMatchObject({
			actor,
			trackInfo: { type: "promise" },
		});
		expect(foundry.documents.ChatMessage.create).not.toHaveBeenCalled();
	});

	// The track did not cross to 5 this time, so no second Moment of
	// Fulfillment: a chat card says the Promise was banked instead.
	it("banks onto a track that was already full, with a chat card and no second announcement", async () => {
		const actor = hero(5, 1);

		await applyPromiseToActor(actor, 2);

		expect(actor.update).toHaveBeenCalledWith({
			"system.promise": 5,
			"system.pendingPromise": 3,
		});
		expect(trackCompleted()).toHaveLength(0);
		expect(foundry.documents.ChatMessage.create).toHaveBeenCalledTimes(1);
		expect(foundry.documents.ChatMessage.create).toHaveBeenCalledWith(
			expect.objectContaining({ speaker: { actor: actor.id } }),
		);
	});
});
