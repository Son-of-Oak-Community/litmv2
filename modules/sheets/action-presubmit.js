/**
 * Submit-then-replay guard for action buttons pressed while an input is focused.
 *
 * The browser fires pointerdown → blur → change → pointerup → click, and the
 * blur/change re-render would detach the button before click fires. So on
 * pointerdown we submit the form ourselves, flag the duplicate change-triggered
 * submit for suppression (`app._suppressNextChange`, read by the app's
 * `_onChangeForm`), and run the action manually afterwards.
 *
 * `preventDefault` on pointerdown suppresses the subsequent click (per the
 * Pointer Events spec), and the listener is captured because rAF-deferred
 * renders still fire before the click event in practice.
 *
 * @param {ApplicationV2} app  Rendered app; must expose `element`,
 *   `options.actions` and a writable `_suppressNextChange`.
 * @param {object} options
 * @param {() => HTMLFormElement|null} options.getForm  The form to watch.
 * @param {(form: HTMLFormElement) => Promise<unknown>} options.submit
 *   Submits that form.
 */
export function bindActionPresubmit(app, { getForm, submit }) {
	app.element.addEventListener(
		"pointerdown",
		(event) => {
			const actionBtn = event.target.closest("[data-action]");
			if (!actionBtn) return;
			// ProseMirror's toolbar buttons also use [data-action]; let the
			// editor handle its own controls.
			if (actionBtn.closest("prose-mirror")) return;

			const form = getForm();
			if (!form) return;

			const focused = document.activeElement;
			if (!focused || !form.contains(focused)) return;
			const isFormInput = ["INPUT", "TEXTAREA", "SELECT"].includes(
				focused.tagName,
			);
			// ProseMirror focuses a contenteditable inside the <prose-mirror>
			// custom element, which is form-associated and exposes live editor
			// state via its value getter — so a form submit will pick it up.
			const isProseMirror = !!focused.closest("prose-mirror");
			if (!isFormInput && !isProseMirror) return;

			event.preventDefault();

			const action = actionBtn.dataset.action;
			const dataset = { ...actionBtn.dataset };
			const controls = actionBtn.getAttribute?.("aria-controls");

			app._suppressNextChange = true;
			submit(form)
				.then(() => {
					const handler = app.options.actions[action];
					const fn = typeof handler === "object" ? handler.handler : handler;
					if (!fn) return;
					const syntheticTarget = document.createElement("button");
					Object.assign(syntheticTarget.dataset, dataset);
					if (controls) syntheticTarget.setAttribute("aria-controls", controls);
					fn.call(app, event, syntheticTarget);
				})
				.catch(console.error);
		},
		{ capture: true },
	);
}
