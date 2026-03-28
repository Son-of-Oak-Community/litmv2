/**
 * Mixin that adds shared sheet infrastructure to both LitmActorSheet and LitmItemSheet.
 * These extend different Foundry base classes (ActorSheetV2 vs ItemSheetV2) but share
 * identical behaviour for:
 * - Pointerdown-before-click action guard (submits form before an action fires)
 * - Focus-next restoration across re-renders
 * - _onChangeForm suppression flag
 * - system getter
 *
 * @param {typeof ApplicationV2} Base
 * @returns {typeof ApplicationV2}
 */
export function LitmSheetMixin(Base) {
	return class extends Base {
		/** Whether to suppress the next change-triggered form submit (set by pointerdown pre-submit) */
		_suppressNextChange = false;

		/**
		 * When the user clicks an action button while an input is focused, the browser
		 * fires: pointerdown → blur → change → pointerup → click.
		 * The blur/change triggers a form re-render that would detach the button before
		 * click fires. Fix: on pointerdown, submit the form immediately and suppress
		 * the duplicate change-triggered submit. By the time click fires the document
		 * data is already locally updated (Foundry applies optimistic updates synchronously).
		 * @override
		 */
		_onChangeForm(formConfig, event) {
			if (this._suppressNextChange) {
				this._suppressNextChange = false;
				return;
			}
			super._onChangeForm(formConfig, event);
		}

		/** @override */
		async _onFirstRender(context, options) {
			await super._onFirstRender(context, options);

			// Prevent click from firing (per Pointer Events spec, preventDefault on
			// pointerdown suppresses the subsequent click). We submit the form and
			// execute the action manually, since rAF-deferred renders still fire
			// before the click event in practice.
			this.element.addEventListener(
				"pointerdown",
				(event) => {
					const actionBtn = event.target.closest("[data-action]");
					if (!actionBtn) return;

					const form = this.form;
					if (!form) return;

					const focused = document.activeElement;
					if (!focused || !form.contains(focused)) return;
					if (!["INPUT", "TEXTAREA", "SELECT"].includes(focused.tagName))
						return;

					event.preventDefault();

					const action = actionBtn.dataset.action;
					const dataset = { ...actionBtn.dataset };

					this._suppressNextChange = true;
					this.submit()
						.then(() => {
							const handler = this.options.actions[action];
							const fn =
								typeof handler === "object" ? handler.handler : handler;
							if (!fn) return;
							const syntheticTarget = document.createElement("button");
							Object.assign(syntheticTarget.dataset, dataset);
							fn.call(this, event, syntheticTarget);
						})
						.catch(console.error);
				},
				{ capture: true },
			);

			this.element.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" && event.key !== " ") return;
				const actionEl = event.target.closest("[data-action]");
				if (!actionEl) return;
				event.preventDefault();
				actionEl.click();
			});
		}

		/** @override */
		_preSyncPartState(partId, newElement, priorElement, state) {
			super._preSyncPartState(partId, newElement, priorElement, state);

			const focus = priorElement.querySelector(":focus");
			if (!focus) return;

			const tabbable = [
				...priorElement.querySelectorAll(
					'input:not([type="hidden"]):not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([tabindex="-1"]), [tabindex="0"]',
				),
			];
			const idx = tabbable.indexOf(focus);
			if (idx < 0 || idx >= tabbable.length - 1) return;

			const next = tabbable[idx + 1];
			if (next.id) state.focusNext = `#${CSS.escape(next.id)}`;
			else if (next.name)
				state.focusNext = `${next.tagName.toLowerCase()}[name="${next.name}"]`;
		}

		/** @override */
		_syncPartState(partId, newElement, priorElement, state) {
			super._syncPartState(partId, newElement, priorElement, state);

			if (state.focusNext && document.activeElement === document.body) {
				const el = newElement.querySelector(state.focusNext);
				if (el) el.focus();
			}
		}

		/**
		 * Convenient reference to the document's system data
		 * @type {TypeDataModel}
		 * @protected
		 */
		get system() {
			return this.document.system;
		}
	};
}
