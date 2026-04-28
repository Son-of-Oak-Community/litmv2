import { enrichHTML, localize } from "../utils.js";

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
					// ProseMirror's toolbar buttons also use [data-action]; let the
					// editor handle its own controls.
					if (actionBtn.closest("prose-mirror")) return;

					const form = this.form;
					if (!form) return;

					const focused = document.activeElement;
					if (!focused || !form.contains(focused)) return;
					const isFormInput = ["INPUT", "TEXTAREA", "SELECT"].includes(focused.tagName);
					// ProseMirror focuses a contenteditable inside the <prose-mirror>
					// custom element, which is form-associated and exposes live editor
					// state via its value getter — so submit() will pick it up.
					const isProseMirror = !!focused.closest("prose-mirror");
					if (!isFormInput && !isProseMirror) return;

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

			this.element.addEventListener("drop", (event) => {
				const tagSlot = event.target.closest("[data-power-tag-target]");
				if (tagSlot) {
					tagSlot.classList.remove("is-drop-hover");
					return this._onDropPowerTagRef?.(event, tagSlot);
				}

				const refTarget = event.target.closest("[data-linked-ref-target]");
				if (refTarget) {
					refTarget.classList.remove("is-drop-hover");
					return this._onDropLinkedRef(event, refTarget);
				}

				const textarea = event.target.closest("textarea");
				if (!textarea) return;
				const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
				if (!data?.uuid) return;
				event.preventDefault();
				event.stopPropagation();
				const doc = foundry.utils.fromUuidSync(data.uuid);
				const link = doc?.link ?? `@UUID[${data.uuid}]`;
				const { selectionStart, selectionEnd } = textarea;
				textarea.setRangeText(link, selectionStart, selectionEnd, "end");
				textarea.dispatchEvent(new Event("change", { bubbles: true }));
			});

			this.element.addEventListener("dragenter", (event) => {
				const refTarget = event.target.closest("[data-linked-ref-target]");
				if (refTarget) refTarget.classList.add("is-drop-hover");
				const tagSlot = event.target.closest("[data-power-tag-target]");
				if (tagSlot) tagSlot.classList.add("is-drop-hover");
			});
			this.element.addEventListener("dragleave", (event) => {
				const refTarget = event.target.closest("[data-linked-ref-target]");
				if (refTarget && !refTarget.contains(event.relatedTarget)) {
					refTarget.classList.remove("is-drop-hover");
				}
				const tagSlot = event.target.closest("[data-power-tag-target]");
				if (tagSlot && !tagSlot.contains(event.relatedTarget)) {
					tagSlot.classList.remove("is-drop-hover");
				}
			});

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

		/**
		 * Handle a JournalEntry, JournalEntryPage, or action Item drop on a
		 * tag row to link it as a reference. The drop target carries
		 * `data-effect-id`; the effect's `system.linkedRefUuid` is updated
		 * on the sheet's document.
		 * @param {DragEvent} event
		 * @param {HTMLElement} target  The element matching `[data-linked-ref-target]`
		 * @protected
		 */
		async _onDropLinkedRef(event, target) {
			const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
			if (!data?.uuid) return;
			const accepted = ["JournalEntry", "JournalEntryPage", "Item"];
			if (!accepted.includes(data.type)) return;

			if (data.type === "Item") {
				const doc = await foundry.utils.fromUuid(data.uuid);
				if (doc?.type !== "action") {
					ui.notifications.warn(localize("LITM.Actions.linked_ref_invalid_item"));
					return;
				}
			}

			event.preventDefault();
			event.stopPropagation();

			const effectId = target.dataset.effectId;
			const effect = effectId ? this.document.effects?.get(effectId) : null;
			if (!effect) return;

			await effect.update({ "system.linkedRefUuid": data.uuid });
		}

		/**
		 * Enrich multiple system fields for template rendering.
		 * @param {...string} fields - Dot-path field names on `this.document.system`
		 * @returns {Promise<Record<string, string>>} Map of field name → enriched HTML
		 */
		async _enrichFields(...fields) {
			const enriched = {};
			for (const field of fields) {
				const value = foundry.utils.getProperty(this.document.system, field);
				enriched[field] = value ? await enrichHTML(value, this.document) : "";
			}
			return enriched;
		}
	};
}
