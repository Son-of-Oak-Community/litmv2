import { parseEmbeddedFormKeys, viewLinkedRefAction } from "../utils.js";
import { LitmSheetMixin } from "./litm-sheet-mixin.js";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Base item sheet class for Legend in the Mist
 * Provides common functionality for all item sheet types
 */
export class LitmItemSheet extends LitmSheetMixin(
	HandlebarsApplicationMixin(ItemSheetV2),
) {
	static DEFAULT_OPTIONS = {
		actions: {
			viewLinkedRef: viewLinkedRefAction,
			clearLinkedRef: LitmItemSheet._onClearLinkedRef,
		},
	};

	/**
	 * Clear the linked reference on an embedded effect.
	 * @param {Event} _event
	 * @param {HTMLElement} target
	 * @protected
	 */
	static async _onClearLinkedRef(_event, target) {
		const effectId = target.dataset.effectId;
		const effect = effectId ? this.document.effects.get(effectId) : null;
		if (!effect) return;
		await effect.update({ "system.linkedRefUuid": null });
	}

	/**
	 * Handle form submission, routing `effects.*` fields to embedded
	 * document updates. Subclasses that use effect-bound form fields
	 * should set `form.handler: SubClass._onSubmitFormWithEffects` in
	 * DEFAULT_OPTIONS.
	 * @param {Event} _event
	 * @param {HTMLFormElement} _form
	 * @param {FormDataExtended} formData
	 */
	static async _onSubmitFormWithEffects(_event, _form, formData) {
		const submitData = formData.object;
		const effectMap = parseEmbeddedFormKeys(submitData, "effects.");

		const effectUpdates = [];
		for (const [id, data] of Object.entries(effectMap)) {
			const update = { _id: id };
			if ("name" in data) update.name = data.name;
			if ("isActive" in data) update.disabled = !data.isActive;
			if (data.system) update.system = data.system;
			effectUpdates.push(update);
		}

		if (effectUpdates.length) {
			await this.document.updateEmbeddedDocuments(
				"ActiveEffect",
				effectUpdates,
			);
		}
		await this.document.update(submitData);
	}
}
