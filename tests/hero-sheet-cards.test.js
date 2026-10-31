import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeroSheet } from "../modules/actor/hero/hero-sheet.js";
import { HeroSheetCards } from "../modules/actor/hero/hero-sheet-cards.js";
import { LitmActorSheet } from "../modules/sheets/base-actor-sheet.js";

globalThis.CSS = { escape: String };

const COLLAPSED = HeroSheetCards.PANEL_COLLAPSED_CLASS;

function makeElement({ art = true, placeholder = false } = {}) {
	const classes = new Set();
	const toggle = { setAttribute: vi.fn() };
	return {
		classList: {
			toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
			add: (c) => classes.add(c),
			remove: (c) => classes.delete(c),
			contains: (c) => classes.has(c),
		},
		getAnimations: () => [],
		querySelector: (sel) => {
			if (sel === ".litm--play-header--art") return art ? {} : null;
			if (sel === ".litm--hero-panel-toggle") return toggle;
			if (sel === ".litm--play-portrait--placeholder")
				return placeholder ? {} : null;
			return null;
		},
		querySelectorAll: () => [],
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

	it("enables the fold transition only while the toggle runs it", async () => {
		const { sheet, element } = makeCardsSheet();
		await toggle.call(sheet);
		await Promise.resolve();
		expect(element._classes.has(HeroSheetCards.PANEL_ANIMATING_CLASS)).toBe(
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

describe("HeroSheetCards panel seed on render", () => {
	beforeEach(() => {
		vi.spyOn(HeroSheet.prototype, "_onRender").mockResolvedValue();
	});

	it("starts folded when the hero has no art and no description", async () => {
		game.settings.get.mockReturnValue(false);
		const { sheet, element } = makeCardsSheet({ placeholder: true });
		await sheet._onRender({}, {});
		expect(element._classes.has(COLLAPSED)).toBe(true);
	});

	it("follows the setting when the hero has art", async () => {
		game.settings.get.mockReturnValue(false);
		const { sheet, element } = makeCardsSheet();
		await sheet._onRender({}, {});
		expect(element._classes.has(COLLAPSED)).toBe(false);
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

describe("HeroSheetCards banner double-click", () => {
	const dblclick = HeroSheetCards.prototype._onBannerDblClick;
	const render = vi.fn();
	// A theme banner: closest(".theme-card > legend") → the legend, whose card is the theme.
	const card = { matches: () => false, dataset: { itemId: "t1" } };
	const event = {
		target: {
			closest: (sel) =>
				sel === ".theme-card > legend" ? { parentElement: card } : null,
		},
	};
	const makeSheet = (isEditable) => ({
		isEditable,
		_isEditMode: false,
		document: { items: { get: () => ({ sheet: { render } }) } },
	});

	it("opens the theme's sheet for an owner", () => {
		dblclick.call(makeSheet(true), event);
		expect(render).toHaveBeenCalledWith(true);
	});

	it("leaves a double-click on a tag chip to the chip", () => {
		render.mockClear();
		dblclick.call(makeSheet(true), {
			target: {
				closest: (sel) =>
					sel.includes("[data-tag-id]") ? {} : event.target.closest(sel),
			},
		});
		expect(render).not.toHaveBeenCalled();
	});

	it("does nothing for a viewer who cannot edit the hero", () => {
		render.mockClear();
		dblclick.call(makeSheet(false), event);
		expect(render).not.toHaveBeenCalled();
	});

	it("opens the backpack and themes in Edit mode", () => {
		const backpack = vi.fn();
		const kit = { matches: (sel) => sel === ".litm-kit-card--backpack" };
		const sheet = {
			...makeSheet(true),
			_isEditMode: true,
			document: {
				items: { get: () => ({ sheet: { render } }) },
				system: { backpackItem: { sheet: { render: backpack } } },
			},
		};
		dblclick.call(sheet, {
			target: {
				closest: (sel) =>
					sel === ".litm-kit-card > legend" ? { parentElement: kit } : null,
			},
		});
		expect(backpack).toHaveBeenCalledWith(true);
		render.mockClear();
		dblclick.call(sheet, event);
		expect(render).toHaveBeenCalledWith(true);
	});

	it("asks for a name and adds a status from the Statuses banner in Edit mode", async () => {
		const addStatus = vi.fn();
		const kit = { matches: (sel) => sel === ".litm-kit-card--statuses" };
		const sheet = {
			...makeSheet(true),
			_isEditMode: true,
			_notifyStoryTags: () => {},
			document: { system: { addStatus } },
		};
		foundry.applications.api.DialogV2.input = vi
			.fn()
			.mockResolvedValue({ name: "hurt" });
		await dblclick.call(sheet, {
			target: {
				closest: (sel) =>
					sel === ".litm-kit-card > legend" ? { parentElement: kit } : null,
			},
		});
		expect(foundry.applications.api.DialogV2.input).toHaveBeenCalled();
		expect(addStatus).toHaveBeenCalledWith("hurt", {});
	});
});

describe("HeroSheetCards view-only controls", () => {
	afterEach(() => {
		delete HeroSheet.prototype._toggleDisabled;
	});

	it("keeps the panel toggle and card flips enabled for a viewer", () => {
		const toggle = { disabled: false };
		const flip = { disabled: false };
		const roll = { disabled: false };
		// Stand-in for Foundry's pass, which disables every control in the form.
		HeroSheet.prototype._toggleDisabled = (disabled) => {
			for (const b of [toggle, flip, roll]) b.disabled = disabled;
		};
		const sheet = new HeroSheetCards();
		Object.defineProperty(sheet, "element", {
			value: { querySelectorAll: () => [toggle, flip] },
		});
		sheet._toggleDisabled(true);
		expect(toggle.disabled).toBe(false);
		expect(flip.disabled).toBe(false);
		expect(roll.disabled).toBe(true);
	});
});

describe("HeroSheetCards themes row reorder", () => {
	globalThis.CONST ??= {};
	CONST.SORT_INTEGER_DENSITY ??= 100000;
	const D = CONST.SORT_INTEGER_DENSITY;

	// Row: A, Fellowship, B. `drop` is the card under the pointer.
	function setup(dropKey) {
		const card = (key) => ({
			matches: (sel) =>
				sel === "[data-fellowship-card]" && key === "fellowship",
			dataset: key === "fellowship" ? {} : { itemId: key },
		});
		const cards = ["a", "fellowship", "b"].map(card);
		const row = { querySelectorAll: () => cards };
		for (const c of cards) c.parentElement = row;
		const target = cards[["a", "fellowship", "b"].indexOf(dropKey)];
		const event = {
			target: {
				closest: (sel) =>
					sel === ".litm-hero-board__themes > .theme-card" ? target : null,
			},
		};
		const sheet = new HeroSheetCards();
		const update = vi.fn();
		Object.defineProperty(sheet, "document", { value: { update } });
		return { sheet, event, update };
	}

	it("moves a theme past the Fellowship and saves both in one update", async () => {
		const { sheet, event, update } = setup("b");
		await sheet._onSortItem(event, { type: "theme", id: "a" });
		// A moves right, after B: Fellowship, B, A.
		expect(update).toHaveBeenCalledWith({
			items: [
				{ _id: "b", sort: D },
				{ _id: "a", sort: 2 * D },
			],
			"flags.litmv2.fellowshipIndex": 0,
		});
	});

	it("does not write when a card is dropped on itself", async () => {
		const { sheet, event, update } = setup("a");
		await sheet._onSortItem(event, { type: "theme", id: "a" });
		expect(update).not.toHaveBeenCalled();
	});
});
