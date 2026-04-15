import { LitmItemSheet } from "../../sheets/base-item-sheet.js";
import { enrichHTML, removeAtIndex } from "../../utils.js";

/**
 * Vignette sheet for Legend in the Mist
 * Represents standalone threats with several consequences
 */
export class VignetteSheet extends LitmItemSheet {
	/** @override */
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm-vignette-sheet"],
		tag: "form",
		position: {
			width: 500,
			height: "auto",
		},
		actions: {
			addConsequence: VignetteSheet.#onAddConsequence,
			removeConsequence: VignetteSheet.#onRemoveConsequence,
		},
		form: {
			handler: VignetteSheet.#onSubmitDocumentForm,
			submitOnChange: true,
			closeOnSubmit: false,
		},
		window: {
			icon: "fa-solid fa-skull-crossbones",
			resizable: true,
		},
	};

	/** @override */
	static PARTS = {
		form: {
			template: "systems/litmv2/templates/item/vignette.html",
			scrollable: [""],
		},
	};

	/* -------------------------------------------- */
	/*  Rendering                                   */
	/* -------------------------------------------- */

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		// Enrich threat text for display
		const enrichedThreat = await enrichHTML(this.system.threat, this.document);

		return {
			...context,
			consequences: this.system.consequences,
			effects: this.document.effects,
			enrichedThreat,
			isConsequenceOnly: this.system.isConsequenceOnly,
			system: this.system,
		};
	}

	/* -------------------------------------------- */
	/*  Event Handlers & Actions                    */
	/* -------------------------------------------- */

	/**
	 * Handle form submission
	 * @param {SubmitEvent} event           The form submission event
	 * @param {HTMLFormElement} form        The form element
	 * @param {FormDataExtended} formData   The form data
	 * @returns {Promise<void>}
	 * @private
	 */
	static async #onSubmitDocumentForm(_event, _form, formData) {
		const submitData = formData.object;
		await this.document.update(submitData);

		// Update tags and statuses from consequences
		if (submitData.system?.consequences) {
			await this.document.system.syncEffectsFromConsequences();
		}
	}

	/**
	 * Add a new consequence
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onAddConsequence(_event, _target) {
		const consequences = [...this.system.consequences, ""];
		await this.document.update({ "system.consequences": consequences });
	}

	/**
	 * Remove a consequence
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onRemoveConsequence(_event, target) {
		await removeAtIndex(this.document, "system.consequences", Number(target.dataset.index));
	}
}
