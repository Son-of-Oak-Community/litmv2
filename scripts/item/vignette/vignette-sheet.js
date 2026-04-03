import { LitmItemSheet } from "../../sheets/base-item-sheet.js";
import { enrichHTML } from "../../utils.js";

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
			await VignetteSheet.#updateEffectsFromConsequences(this.document);
		}
	}

	/**
	 * Update embedded effects based on consequence text
	 * @param {Item} doc  The vignette document
	 * @private
	 */
	static async #updateEffectsFromConsequences(doc) {
		const matches = doc.system.consequences.flatMap((string) =>
			Array.from(string.matchAll(CONFIG.litmv2.tagStringRe)),
		);

		// Build desired effects list from consequence text
		const desired = matches.map(([_, name, separator, value]) => {
			if (separator === "-") {
				return { name, type: "status_tag", tierIndex: Number(value) };
			}
			return { name, type: "story_tag", tierIndex: null };
		});

		// Key existing effects for matching
		const existing = new Map();
		for (const e of doc.effects) {
			existing.set(`${e.type}::${e.name}`, e);
		}

		const toCreate = [];
		const toUpdate = [];
		const matched = new Set();

		for (const d of desired) {
			const key = `${d.type}::${d.name}`;
			const found = existing.get(key);
			if (found) {
				matched.add(found.id);
				if (d.type === "status_tag" && d.tierIndex != null) {
					const newTiers = Array.from({ length: 6 }, (_, i) => i + 1 === d.tierIndex);
					if (newTiers.some((v, i) => v !== found.system.tiers[i])) {
						toUpdate.push({ _id: found.id, "system.tiers": newTiers });
					}
				}
			} else {
				const effectData = d.type === "status_tag"
					? { name: d.name, type: "status_tag", system: { tiers: Array.from({ length: 6 }, (_, i) => i + 1 === d.tierIndex) } }
					: { name: d.name, type: "story_tag", system: { isScratched: false, isSingleUse: false } };
				toCreate.push(effectData);
			}
		}

		const toDelete = [...existing.values()]
			.filter((e) => !matched.has(e.id))
			.map((e) => e.id);

		if (toDelete.length) await doc.deleteEmbeddedDocuments("ActiveEffect", toDelete);
		if (toUpdate.length) await doc.updateEmbeddedDocuments("ActiveEffect", toUpdate);
		if (toCreate.length) await doc.createEmbeddedDocuments("ActiveEffect", toCreate);
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
		const index = Number(target.dataset.index);
		const consequences = this.system.consequences.filter((_, i) => i !== index);
		await this.document.update({ "system.consequences": consequences });
	}
}
