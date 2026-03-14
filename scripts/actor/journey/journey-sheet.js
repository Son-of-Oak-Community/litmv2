import { LitmActorSheet } from "../../sheets/base-actor-sheet.js";
import { confirmDelete, enrichHTML } from "../../utils.js";

/**
 * Journey sheet for Legend in the Mist
 * Represents a sequence of vignettes with general consequences
 */
export class JourneySheet extends LitmActorSheet {
	/** @override */
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm-journey-sheet"],
		tag: "form",
		actions: {
			addVignette: JourneySheet.#onAddVignette,
			editVignette: JourneySheet.#onEditVignette,
			removeVignette: JourneySheet.#onRemoveVignette,
			clearGeneralConsequence: JourneySheet.#onClearGeneralConsequence,
			addStoryTag: LitmActorSheet._onAddStoryTag,
			removeEffect: LitmActorSheet._onRemoveEffect,
			toggleEffectVisibility: LitmActorSheet._onToggleEffectVisibility,
		},
		form: {
			handler: LitmActorSheet._onSubmitActorForm,
			submitOnChange: true,
			closeOnSubmit: false,
		},
		window: {
			icon: "fa-solid fa-route",
			resizable: true,
		},
		dragDrop: [{ dropSelector: null }],
	};

	/** @override */
	static PARTS = {
		form: {
			template: "systems/litmv2/templates/actor/journey.html",
			scrollable: [""],
		},
	};

	/** @override */
	static _getEditModeTemplate() {
		return "systems/litmv2/templates/actor/journey.html";
	}

	/** @override */
	static _getPlayModeTemplate() {
		return "systems/litmv2/templates/actor/journey-play.html";
	}

	/* -------------------------------------------- */
	/*  Rendering                                   */
	/* -------------------------------------------- */

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		const enrichedDescription = await enrichHTML(
			this.system.description,
			this.document,
		);

		// Prepare vignette items
		const generalConsequenceId = this.system.generalConsequences;
		const {
			vignettes,
			vignettesByType,
			excluded: generalConsequence,
		} = await this._prepareVignettes({ excludeId: generalConsequenceId });

		return {
			...context,
			isGM: game.user.isGM,
			isOwner: this.document.isOwner,
			isEditMode: this._isEditMode,
			enriched: {
				description: enrichedDescription,
			},
			storyTags: this._prepareStoryTags(),
			tagTypeOptions: { tag: "LITM.Terms.tag", status: "LITM.Terms.status" },
			generalConsequenceId,
			generalConsequence,
			vignettes,
			vignettesByType,
			displayVignettes: vignettesByType.flatMap((g) => g.vignettes),
		};
	}

	/* -------------------------------------------- */
	/*  Event Handlers & Actions                    */
	/* -------------------------------------------- */

	/**
	 * Add a new vignette
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onAddVignette(_event, _target) {
		const [vignette] = await this.document.createEmbeddedDocuments("Item", [
			{ name: game.i18n.localize("LITM.Ui.new_vignette"), type: "vignette" },
		]);
		vignette.sheet.render(true);
	}

	/**
	 * Remove a vignette
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onRemoveVignette(_event, target) {
		if (!(await confirmDelete("TYPES.Item.vignette"))) return;

		const itemId = target.dataset.itemId;
		const item = this.document.items.get(itemId);
		await item?.delete();
	}

	/**
	 * Edit a vignette
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static #onEditVignette(_event, target) {
		const itemId = target.dataset.itemId;
		const item = this.document.items.get(itemId);
		item?.sheet.render(true);
	}

	/**
	 * Clear the general consequence vignette
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onClearGeneralConsequence(_event, _target) {
		await this.document.update({ "system.generalConsequences": "" });
	}

	/* -------------------------------------------- */
	/*  Drag & Drop                                 */
	/* -------------------------------------------- */

	/** @override */
	async _onDropItem(event, item) {
		if (item.type !== "vignette") return;

		const dropZone = event.target?.closest?.("[data-drop-zone]");
		if (dropZone?.dataset?.dropZone === "general-consequences") {
			let vignetteId = null;
			const isOnThisJourney = item.parent?.id === this.document.id;

			if (isOnThisJourney) {
				vignetteId = item.id;
			} else {
				const itemData = item.toObject();
				delete itemData._id;
				const [created] = await this.document.createEmbeddedDocuments("Item", [
					itemData,
				]);
				vignetteId = created?.id;
			}

			if (!vignetteId) return;

			const existingId = this.system.generalConsequences;
			if (existingId && existingId !== vignetteId) {
				const shouldReplace = await foundry.applications.api.DialogV2.confirm({
					window: {
						title: game.i18n.localize(
							"LITM.Ui.replace_general_consequence_title",
						),
					},
					content: game.i18n.localize(
						"LITM.Ui.replace_general_consequence_content",
					),
					no: { default: true },
					classes: ["litm"],
				});
				if (!shouldReplace) return;
			}

			await this.document.update({
				"system.generalConsequences": vignetteId,
			});
			return;
		}

		return super._onDropItem(event, item);
	}
}
