import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bindActionPresubmit } from "../modules/sheets/action-presubmit.js";

// The pointerdown guard behind both LitmSheetMixin and the story-tag sidebar:
// submit the form, then replay the action, when an action button is pressed
// while an input is focused.

let handler;
let form;
let app;
let submit;

const makeEvent = ({
	action = "rollIt",
	inProseMirrorToolbar = false,
} = {}) => {
	const actionBtn = {
		dataset: { action, itemId: "i1" },
		closest: vi.fn((sel) =>
			sel === "prose-mirror" ? inProseMirrorToolbar : null,
		),
	};
	return {
		target: { closest: vi.fn(() => actionBtn) },
		preventDefault: vi.fn(),
	};
};

const focus = (el) => {
	globalThis.document.activeElement = el;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	form = { contains: vi.fn(() => true) };
	submit = vi.fn(async () => {});
	app = {
		_suppressNextChange: false,
		options: { actions: { rollIt: vi.fn() } },
		element: {
			addEventListener: vi.fn((type, fn, opts) => {
				if (type === "pointerdown") handler = { fn, opts };
			}),
		},
	};
	globalThis.document = {
		activeElement: null,
		createElement: vi.fn(() => ({ dataset: {} })),
	};
	bindActionPresubmit(app, { getForm: () => form, submit });
});

afterEach(() => {
	delete globalThis.document;
});

describe("bindActionPresubmit", () => {
	it("listens on pointerdown in the capture phase", () => {
		expect(handler.opts).toEqual({ capture: true });
	});

	it("submits, suppresses the change submit, then replays the action", async () => {
		focus({ tagName: "INPUT", closest: () => null });
		const event = makeEvent();

		handler.fn(event);
		expect(event.preventDefault).toHaveBeenCalled();
		expect(app._suppressNextChange).toBe(true);
		expect(submit).toHaveBeenCalledWith(form);
		await flush();

		const rollIt = app.options.actions.rollIt;
		expect(rollIt).toHaveBeenCalledTimes(1);
		const [passedEvent, syntheticTarget] = rollIt.mock.calls[0];
		expect(passedEvent).toBe(event);
		expect(syntheticTarget.dataset).toEqual({ action: "rollIt", itemId: "i1" });
	});

	it("accepts an object action handler", async () => {
		const objectHandler = vi.fn();
		app.options.actions.rollIt = { handler: objectHandler };
		focus({ tagName: "TEXTAREA", closest: () => null });

		handler.fn(makeEvent());
		await flush();

		expect(objectHandler).toHaveBeenCalledTimes(1);
	});

	it("lets the click through when nothing in the form is focused", () => {
		form.contains.mockReturnValue(false);
		focus({ tagName: "INPUT", closest: () => null });
		const event = makeEvent();

		handler.fn(event);

		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(submit).not.toHaveBeenCalled();
	});

	it("lets the click through when the focus is not a text control", () => {
		focus({ tagName: "BUTTON", closest: () => null });
		const event = makeEvent();

		handler.fn(event);

		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(submit).not.toHaveBeenCalled();
	});

	it("treats a focused ProseMirror editor as a form input", async () => {
		focus({ tagName: "DIV", closest: (sel) => sel === "prose-mirror" });

		handler.fn(makeEvent());
		await flush();

		expect(submit).toHaveBeenCalled();
		expect(app.options.actions.rollIt).toHaveBeenCalled();
	});

	it("leaves ProseMirror's own toolbar buttons alone", () => {
		focus({ tagName: "INPUT", closest: () => null });
		const event = makeEvent({ inProseMirrorToolbar: true });

		handler.fn(event);

		expect(event.preventDefault).not.toHaveBeenCalled();
		expect(submit).not.toHaveBeenCalled();
	});

	it("does nothing when the app has no form yet", () => {
		const event = makeEvent();
		const unbound = { ...app, element: { addEventListener: vi.fn() } };
		bindActionPresubmit(unbound, { getForm: () => null, submit });
		const [, fn] = unbound.element.addEventListener.mock.calls[0];
		focus({ tagName: "INPUT", closest: () => null });

		fn(event);

		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it("skips the replay when the action is not registered", async () => {
		app.options.actions = {};
		focus({ tagName: "INPUT", closest: () => null });

		handler.fn(makeEvent());
		await flush();

		expect(submit).toHaveBeenCalled();
		expect(globalThis.document.createElement).not.toHaveBeenCalled();
	});
});
