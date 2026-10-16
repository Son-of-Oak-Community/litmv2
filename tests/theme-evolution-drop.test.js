import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	applyDroppedTheme,
	ThemeEvolutionWizard,
} from "../modules/apps/theme-evolution.js";
import { fakeActor, fakeEffect, fakeItem } from "./__helpers__/factories.js";

// The wizard's drop-to-replace path: dropping a theme item on the "new theme"
// fieldset replaces the theme being evolved with a full copy of it.

const originalUx = foundry.applications.ux;
const originalConfirm = foundry.applications.api.DialogV2.confirm;

/** A power/weakness effect that can hand back creation data like a real one. */
function tagEffect({ name, type = "power_tag", isTitleTag = false }) {
	const effect = fakeEffect({ name, type, system: { isTitleTag } });
	effect.toObject = () => ({
		_id: effect.id,
		name,
		type,
		system: { isTitleTag },
	});
	return effect;
}

/**
 * A theme item whose effect collection really empties when effects are
 * deleted, as Foundry's EmbeddedCollection does.
 */
function fakeTheme({
	name = "Theme",
	power = 4,
	weakness = 2,
	isFellowship = false,
	specials = [],
} = {}) {
	const effects = [tagEffect({ name: `${name} title`, isTitleTag: true })];
	for (let i = 0; i < power; i++) {
		effects.push(tagEffect({ name: `${name} power ${i}` }));
	}
	for (let i = 0; i < weakness; i++) {
		effects.push(
			tagEffect({ name: `${name} weakness ${i}`, type: "weakness_tag" }),
		);
	}
	const theme = fakeItem({ name, type: "theme", effects });
	theme.system = {
		isFellowship,
		themebook: `${name} book`,
		level: "origin",
		description: `${name} description`,
		quest: { description: `${name} quest` },
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

const POWER_NAMES = (call) => call.map((e) => e.name);

beforeEach(() => {
	vi.clearAllMocks();
	game.actors.get = vi.fn();
	game.user.isGM = false;
});

afterEach(() => {
	foundry.applications.ux = originalUx;
	foundry.applications.api.DialogV2.confirm = originalConfirm;
});

describe("applyDroppedTheme", () => {
	it("keeps the copied tags and Promise gain when source and target are the same theme", async () => {
		const actor = fakeActor({ system: { promise: 0, pendingPromise: 0 } });
		const theme = fakeTheme({ name: "Hardened Warrior" });
		actor.items = [theme];

		await applyDroppedTheme({ actor, theme, dropped: theme });

		const [, created] = theme.createEmbeddedDocuments.mock.calls[0];
		expect(POWER_NAMES(created).sort()).toEqual(
			[
				"Hardened Warrior power 0",
				"Hardened Warrior power 1",
				"Hardened Warrior power 2",
				"Hardened Warrior power 3",
				"Hardened Warrior weakness 0",
				"Hardened Warrior weakness 1",
			].sort(),
		);
		// Creation data must not carry the old ids over.
		expect(created.every((e) => e._id === undefined)).toBe(true);
		// 4 power (1 over baseline) + 2 weakness (1 over baseline) + base 1.
		expect(actor.update).toHaveBeenCalledWith({ "system.promise": 3 });
	});

	it("copies the source's tags onto a different target", async () => {
		const actor = fakeActor({ system: { promise: 1, pendingPromise: 0 } });
		const target = fakeTheme({ name: "Target", power: 2, weakness: 1 });
		const source = fakeTheme({ name: "Source", power: 4, weakness: 2 });
		actor.items = [target];

		await applyDroppedTheme({ actor, theme: target, dropped: source });

		const [, created] = target.createEmbeddedDocuments.mock.calls[0];
		expect(created).toHaveLength(6);
		expect(actor.update).toHaveBeenCalledWith({ "system.promise": 4 });
	});

	it("refuses a Fellowship theme dropped on a Hero theme without touching anything", async () => {
		const actor = fakeActor({ system: { promise: 0, pendingPromise: 0 } });
		const theme = fakeTheme({ name: "Hero theme" });
		const dropped = fakeTheme({ name: "Fellowship", isFellowship: true });

		await applyDroppedTheme({ actor, theme, dropped });

		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.evolution_drop_theme_kind_mismatch",
		);
		expect(theme.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(Hooks.callAll).not.toHaveBeenCalled();
	});

	it("fires litm.themeAdvanced with the replace payload shape the form path uses", async () => {
		const actor = fakeActor({ name: "Gerrin", system: { promise: 0 } });
		const theme = fakeTheme({ name: "Target" });
		const dropped = fakeTheme({ name: "Source", power: 4, weakness: 2 });

		await applyDroppedTheme({ actor, theme, dropped });

		expect(Hooks.callAll).toHaveBeenCalledTimes(1);
		const [hook, hookActor, hookTheme, payload] = Hooks.callAll.mock.calls[0];
		expect(hook).toBe("litm.themeAdvanced");
		expect(hookActor).toBe(actor);
		expect(hookTheme).toBe(theme);
		// Same keys the form path spreads in from buildThemeUpdate...
		expect(payload).toMatchObject({
			name: "Source",
			"system.themebook": "Source book",
			"system.level": "origin",
			"system.nascentImprovements": 2,
		});
		// ...plus the evolution summary it always carries.
		expect(payload.litmEvolution).toEqual({
			mode: "replace",
			promiseGained: 3,
			tradedCount: 2,
			dropped: true,
		});
	});

	it("posts the replaced notification", async () => {
		const actor = fakeActor({ name: "Gerrin", system: { promise: 0 } });
		const theme = fakeTheme({ name: "Target" });
		const dropped = fakeTheme({ name: "Source" });
		const format = vi.spyOn(game.i18n, "format");

		await applyDroppedTheme({ actor, theme, dropped });

		expect(format).toHaveBeenCalledWith(
			"LITM.Ui.evolution_replaced_notification",
			{ theme: "Source", actor: "Gerrin" },
		);
		expect(ui.notifications.info).toHaveBeenCalledTimes(1);
		format.mockRestore();
	});

	it("gains no Promise for a Fellowship theme, but still fires the hook", async () => {
		const actor = fakeActor({ system: { promise: 0 } });
		const theme = fakeTheme({ name: "Fellowship A", isFellowship: true });
		const dropped = fakeTheme({
			name: "Fellowship B",
			isFellowship: true,
			power: 4,
			weakness: 2,
		});

		await applyDroppedTheme({ actor, theme, dropped });

		expect(actor.update).not.toHaveBeenCalled();
		const payload = Hooks.callAll.mock.calls[0][3];
		expect(payload.litmEvolution.promiseGained).toBe(0);
		expect(payload.litmEvolution.mode).toBe("replace");
	});
});

describe("ThemeEvolutionWizard drop handler", () => {
	/** Build a wizard and hand back the drop callback it registers. */
	function wizardFor({ actor, theme, dragged }) {
		let dropCallback;
		foundry.applications.ux = {
			DragDrop: {
				implementation: class {
					constructor(options) {
						dropCallback = options.callbacks.drop;
					}
				},
			},
			TextEditor: {
				implementation: { getDragEventData: () => dragged },
			},
		};
		game.actors.get = vi.fn(() => actor);
		actor.items = { get: vi.fn(() => theme) };
		const wizard = new ThemeEvolutionWizard({
			actorId: actor.id,
			themeId: theme.id,
		});
		wizard.close = vi.fn();
		// Reading the getter is what registers the callbacks.
		void wizard._dragDrop;
		return { wizard, drop: dropCallback };
	}

	it("rejects dropping the theme being evolved onto its own wizard", async () => {
		const actor = fakeActor({ system: { promise: 0 } });
		const theme = fakeTheme({ name: "Hardened Warrior" });
		const confirm = vi.fn(async () => true);
		foundry.applications.api.DialogV2.confirm = confirm;
		const { wizard, drop } = wizardFor({
			actor,
			theme,
			dragged: { type: "Item", uuid: theme.uuid },
		});
		foundry.utils.fromUuid.mockResolvedValueOnce(theme);

		await drop({});

		expect(ui.notifications.warn).toHaveBeenCalledWith(
			"LITM.Ui.evolution_drop_theme_same",
		);
		expect(confirm).not.toHaveBeenCalled();
		expect(theme.deleteEmbeddedDocuments).not.toHaveBeenCalled();
		expect(theme.update).not.toHaveBeenCalled();
		expect(Hooks.callAll).not.toHaveBeenCalled();
		expect(wizard.close).not.toHaveBeenCalled();
		expect(theme.effects).toHaveLength(7);
	});

	it("replaces the theme with a different dropped theme, fires the hook and closes", async () => {
		const actor = fakeActor({ system: { promise: 0 } });
		const theme = fakeTheme({ name: "Target", power: 2, weakness: 1 });
		const source = fakeTheme({ name: "Source", power: 4, weakness: 2 });
		foundry.applications.api.DialogV2.confirm = vi.fn(async () => true);
		const { wizard, drop } = wizardFor({
			actor,
			theme,
			dragged: { type: "Item", uuid: source.uuid },
		});
		foundry.utils.fromUuid.mockResolvedValueOnce(source);

		await drop({});

		expect(ui.notifications.warn).not.toHaveBeenCalled();
		const [, created] = theme.createEmbeddedDocuments.mock.calls[0];
		expect(created).toHaveLength(6);
		expect(Hooks.callAll).toHaveBeenCalledWith(
			"litm.themeAdvanced",
			actor,
			theme,
			expect.objectContaining({
				litmEvolution: expect.objectContaining({ mode: "replace" }),
			}),
		);
		expect(ui.notifications.info).toHaveBeenCalledTimes(1);
		expect(wizard.close).toHaveBeenCalled();
	});
});
