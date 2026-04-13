import { LitmActorSheet } from "../../sheets/base-actor-sheet.js";
import { TagStringSyncMixin } from "../../sheets/tag-string-sync-mixin.js";
import { enrichHTML } from "../../utils.js";

/**
 * Journey sheet for Legend in the Mist
 * Represents a sequence of vignettes with general consequences
 */
export class JourneySheet extends TagStringSyncMixin(LitmActorSheet) {
	/** @override */
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm-journey-sheet"],
		tag: "form",
		actions: {
			addVignette: LitmActorSheet._onAddVignette,
			editVignette: LitmActorSheet._onEditVignette,
			removeVignette: LitmActorSheet._onRemoveVignette,
			clearGeneralConsequence: JourneySheet.#onClearGeneralConsequence,
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
		header: { template: "systems/litmv2/templates/parts/header.html" },
		description: { template: "systems/litmv2/templates/parts/description.html" },
		content: { template: "systems/litmv2/templates/actor/journey-content.html" },
	};

	static PLAY_CONTENT_TEMPLATE = "systems/litmv2/templates/actor/journey-play-content.html";

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

		const enrichedTags = await enrichHTML(
			this.system.tags || "",
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
			headerFields: [
				{
					id: "category",
					label: "LITM.Terms.type",
					name: "system.category",
					type: "text",
					value: this.document._source.system.category,
					placeholder: "LITM.Ui.name_category",
				},
			],
			enriched: {
				description: enrichedDescription,
				tags: enrichedTags,
			},
			tagsString: this.system.tags || "",
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
