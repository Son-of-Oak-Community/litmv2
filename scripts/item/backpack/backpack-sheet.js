import { LitmItemSheet } from "../../sheets/base-item-sheet.js";
import { confirmDelete, localize as t, storyTagEffect } from "../../utils.js";

/**
 * Backpack sheet for Legend in the Mist
 * Container for story tags and temporary items
 */
export class BackpackSheet extends LitmItemSheet {
	/** @override */
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm-backpack-sheet"],
		tag: "form",
		position: {
			width: 500,
			height: "auto",
		},
		actions: {
			addTag: BackpackSheet.#onAddTag,
			removeTag: BackpackSheet.#onRemoveTag,
		},
		form: {
			submitOnChange: true,
			closeOnSubmit: false,
			handler: BackpackSheet._onSubmitFormWithEffects,
		},
		window: {
			icon: "fa-solid fa-bag-shopping",
			resizable: true,
		},
	};

	/** @override */
	static PARTS = {
		form: {
			template: "systems/litmv2/templates/item/backpack.html",
			scrollable: [""],
		},
	};

	/* -------------------------------------------- */
	/*  Rendering                                   */
	/* -------------------------------------------- */

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		return foundry.utils.mergeObject(context, {
			tags: this.system.tags,
			name: this.document.name,
		});
	}

	/* -------------------------------------------- */
	/*  Event Handlers & Actions                    */
	/* -------------------------------------------- */

	/**
	 * Add a new tag to the backpack
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onAddTag(_event, _target) {
		await this.document.createEmbeddedDocuments("ActiveEffect", [
			storyTagEffect({ name: t("LITM.Ui.name_tag") }),
		]);
	}

	/**
	 * Remove a tag from the backpack
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onRemoveTag(_event, target) {
		if (!(await confirmDelete("LITM.Terms.tag"))) return;
		const effectId = target.dataset.effectId;
		if (!effectId) return;
		await this.document.deleteEmbeddedDocuments("ActiveEffect", [effectId]);
	}
}
