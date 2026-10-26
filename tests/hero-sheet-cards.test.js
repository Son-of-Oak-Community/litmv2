import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeroSheet } from "../modules/actor/hero/hero-sheet.js";
import { LitmActorSheet } from "../modules/sheets/base-actor-sheet.js";
import { HeroSheetCards } from "../modules/sheets/landscape-sheets.js";

globalThis.CSS = { escape: String };

const COLLAPSED = HeroSheetCards.PANEL_COLLAPSED_CLASS;

function makeElement({ art = true } = {}) {
	const classes = new Set();
	const toggle = { setAttribute: vi.fn() };
	return {
		classList: {
			toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
			contains: (c) => classes.has(c),
		},
		querySelector: (sel) => {
			if (sel === ".litm--play-header--art") return art ? {} : null;
			if (sel === ".litm--hero-panel-toggle") return toggle;
			return null;
		},
		_toggle: toggle,
		_classes: classes,
	};
}

// The fold state lives in a private field, so use a real instance and only
// fake `element`. #measureDescription finds no description body and returns early.
function makeCardsSheet(opts) {
	const sheet = new HeroSheetCards();
	const element = makeElement(opts);
	Object.defineProperty(sheet, "element", { value: element });
	return { sheet, element };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("HeroSheetCards toggleHeroPanel", () => {
	const toggle = HeroSheetCards.DEFAULT_OPTIONS.actions.toggleHeroPanel;

	it("is wired to the protected static handler", () => {
		expect(toggle).toBe(HeroSheetCards._onToggleHeroPanel);
	});

	it("folds, syncs aria-expanded and writes the setting; second call unfolds", async () => {
		const { sheet, element } = makeCardsSheet();
		await toggle.call(sheet);
		expect(element._classes.has(COLLAPSED)).toBe(true);
		expect(element._toggle.setAttribute).toHaveBeenLastCalledWith(
			"aria-expanded",
			"false",
		);
		expect(game.settings.set).toHaveBeenLastCalledWith(
			"litmv2",
			"heroPanelCollapsed",
			true,
		);
		await toggle.call(sheet);
		expect(element._classes.has(COLLAPSED)).toBe(false);
		expect(element._toggle.setAttribute).toHaveBeenLastCalledWith(
			"aria-expanded",
			"true",
		);
		expect(game.settings.set).toHaveBeenLastCalledWith(
			"litmv2",
			"heroPanelCollapsed",
			false,
		);
	});

	it("does not apply the class without the art layout, but still persists", async () => {
		const { sheet, element } = makeCardsSheet({ art: false });
		await toggle.call(sheet);
		expect(element._classes.has(COLLAPSED)).toBe(false);
		expect(game.settings.set).toHaveBeenCalledWith(
			"litmv2",
			"heroPanelCollapsed",
			true,
		);
	});
});

describe("HeroSheet editNotes", () => {
	const editNotes = HeroSheet.DEFAULT_OPTIONS.actions.editNotes;
	const makeSheet = () => ({
		isEditable: true,
		document: {
			id: "h1",
			uuid: "Actor.h1",
			name: "Hero",
			system: { notes: "old <b>" },
			update: vi.fn(),
		},
	});

	beforeEach(() => {
		foundry.applications.instances = new Map();
		foundry.applications.api.DialogV2.input = vi.fn();
	});

	it("saves system.notes on confirm and uses a stable id", async () => {
		const sheet = makeSheet();
		foundry.applications.api.DialogV2.input.mockResolvedValue({ notes: "new" });
		await editNotes.call(sheet);
		const opts = foundry.applications.api.DialogV2.input.mock.calls[0][0];
		expect(opts.id).toBe("litm-notes-h1");
		expect(opts.content).toContain("old &lt;b&gt;");
		expect(sheet.document.update).toHaveBeenCalledWith({
			"system.notes": "new",
		});
	});

	it.each([null, undefined])("skips the update on cancel (%s)", async (r) => {
		const sheet = makeSheet();
		foundry.applications.api.DialogV2.input.mockResolvedValue(r);
		await editNotes.call(sheet);
		expect(sheet.document.update).not.toHaveBeenCalled();
	});

	it("does nothing when the sheet cannot save (e.g. a locked compendium)", async () => {
		const sheet = { ...makeSheet(), isEditable: false };
		await editNotes.call(sheet);
		expect(foundry.applications.api.DialogV2.input).not.toHaveBeenCalled();
		expect(sheet.document.update).not.toHaveBeenCalled();
	});

	it("reuses an already-open dialog instead of opening another", async () => {
		const sheet = makeSheet();
		const open = { bringToFront: vi.fn() };
		foundry.applications.instances.set("litm-notes-h1", open);
		await editNotes.call(sheet);
		expect(open.bringToFront).toHaveBeenCalled();
		expect(foundry.applications.api.DialogV2.input).not.toHaveBeenCalled();
		expect(sheet.document.update).not.toHaveBeenCalled();
	});
});

describe("toggleThemeDescription", () => {
	const action = LitmActorSheet.DEFAULT_OPTIONS.actions.toggleThemeDescription;

	function makeDesc({ id = "desc-1", bodyHeight = 120 } = {}) {
		const classes = new Set();
		const props = {};
		return {
			id,
			classList: {
				toggle: (c) => {
					classes.has(c) ? classes.delete(c) : classes.add(c);
					return classes.has(c);
				},
				contains: (c) => classes.has(c),
			},
			style: { setProperty: (k, v) => (props[k] = v) },
			querySelector: () => ({ scrollHeight: bodyHeight }),
			_props: props,
		};
	}

	function setup(desc) {
		const controller = { setAttribute: vi.fn() };
		const element = {
			querySelector: vi.fn((sel) => {
				if (sel === `#${desc.id}`) return desc;
				if (sel === `[aria-controls="${desc.id}"]`) return controller;
				return null;
			}),
		};
		return { sheet: { element }, controller };
	}

	it("finds the description via aria-controls and syncs aria-expanded", () => {
		const desc = makeDesc();
		const { sheet, controller } = setup(desc);
		const target = {
			getAttribute: () => "desc-1",
			closest: () => null,
			querySelector: () => null,
		};
		action.call(sheet, { target: { closest: () => null } }, target);
		expect(desc.classList.contains("is-expanded")).toBe(true);
		expect(desc._props["--description-height"]).toBe("120px");
		expect(controller.setAttribute).toHaveBeenLastCalledWith(
			"aria-expanded",
			"true",
		);
		action.call(sheet, { target: { closest: () => null } }, target);
		expect(controller.setAttribute).toHaveBeenLastCalledWith(
			"aria-expanded",
			"false",
		);
	});

	it("leaves a static description alone", () => {
		const desc = makeDesc();
		desc.classList.toggle("is-static");
		const { sheet, controller } = setup(desc);
		const target = {
			getAttribute: () => "desc-1",
			closest: () => null,
			querySelector: () => null,
		};
		action.call(sheet, { target: { closest: () => null } }, target);
		expect(desc.classList.contains("is-expanded")).toBe(false);
		expect(controller.setAttribute).not.toHaveBeenCalled();
	});

	it("ignores clicks on links and inputs", () => {
		const desc = makeDesc();
		const { sheet, controller } = setup(desc);
		const target = { getAttribute: () => "desc-1" };
		action.call(sheet, { target: { closest: () => ({}) } }, target);
		expect(desc.classList.contains("is-expanded")).toBe(false);
		expect(controller.setAttribute).not.toHaveBeenCalled();
	});

	it("does nothing when the description cannot be resolved", () => {
		const sheet = { element: { querySelector: () => null } };
		const target = {
			getAttribute: () => "missing",
			closest: () => null,
			querySelector: () => null,
		};
		expect(() =>
			action.call(sheet, { target: { closest: () => null } }, target),
		).not.toThrow();
	});
});
