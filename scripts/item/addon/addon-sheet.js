import { LitmItemSheet } from "../../sheets/base-item-sheet.js";
import { enrichHTML, removeAtIndex } from "../../utils.js";
import { MIGHT_OPTIONS } from "../../system/config.js";
import { ChallengeData } from "../../actor/challenge/challenge-data.js";

export class AddonSheet extends LitmItemSheet {
	/** @override */
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm-addon-sheet"],
		tag: "form",
		position: {
			width: 550,
			height: "auto",
		},
		actions: {
			addCategory: AddonSheet.#onAddCategory,
			removeCategory: AddonSheet.#onRemoveCategory,
			addLimit: AddonSheet.#onAddLimit,
			removeLimit: AddonSheet.#onRemoveLimit,
			addMight: AddonSheet.#onAddMight,
			removeMight: AddonSheet.#onRemoveMight,
			addThreat: AddonSheet.#onAddThreat,
			removeThreat: AddonSheet.#onRemoveThreat,
			addConsequence: AddonSheet.#onAddConsequence,
			removeConsequence: AddonSheet.#onRemoveConsequence,
		},
		form: {
			handler: AddonSheet.#onSubmitForm,
			submitOnChange: true,
			closeOnSubmit: false,
		},
		window: {
			icon: "fa-solid fa-puzzle-piece",
			resizable: true,
		},
	};

	/** @override */
	static PARTS = {
		form: {
			template: "systems/litmv2/templates/item/addon.html",
			scrollable: [""],
		},
	};

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		const enriched = await this._enrichFields("description", "specialFeatures");

		const threats = await Promise.all(
			this.system.threats.map(async (t, index) => ({
				...t,
				index,
				enrichedThreat: await enrichHTML(t.threat, this.document),
				enrichedConsequences: await Promise.all(
					t.consequences.map((c) => enrichHTML(c, this.document)),
				),
			})),
		);

		return {
			...context,
			system: this.system,
			enriched,
			threats,
			mightOptions: MIGHT_OPTIONS,
		};
	}

	static async #onSubmitForm(_event, _form, formData) {
		const submitData = formData.object;
		await this.document.update(submitData);
	}

	static async #onAddCategory(_event, _target) {
		const categories = [...this.system.categories, ""];
		await this.document.update({ "system.categories": categories });
	}

	static async #onRemoveCategory(_event, target) {
		await removeAtIndex(this.document, "system.categories", Number(target.dataset.index));
	}

	static async #onAddLimit(_event, _target) {
		const limits = [...this.system.limits, ChallengeData.newLimit()];
		await this.document.update({ "system.limits": limits });
	}

	static async #onRemoveLimit(_event, target) {
		await removeAtIndex(this.document, "system.limits", Number(target.dataset.index));
	}

	static async #onAddMight(_event, _target) {
		const might = [
			...this.system.might,
			{ level: "adventure", description: "" },
		];
		await this.document.update({ "system.might": might });
	}

	static async #onRemoveMight(_event, target) {
		await removeAtIndex(this.document, "system.might", Number(target.dataset.index));
	}

	static async #onAddThreat(_event, _target) {
		const threats = [
			...this.system.threats,
			{
				name: "",
				threat: "",
				consequences: [],
				isConsequenceOnly: false,
			},
		];
		await this.document.update({ "system.threats": threats });
	}

	static async #onRemoveThreat(_event, target) {
		await removeAtIndex(this.document, "system.threats", Number(target.dataset.index));
	}

	static async #onAddConsequence(_event, target) {
		const threatIndex = Number(target.dataset.threatIndex);
		const threats = foundry.utils.deepClone(this.system.threats);
		threats[threatIndex].consequences.push("");
		await this.document.update({ "system.threats": threats });
	}

	static async #onRemoveConsequence(_event, target) {
		const threatIndex = Number(target.dataset.threatIndex);
		const consequenceIndex = Number(target.dataset.consequenceIndex);
		const threats = foundry.utils.deepClone(this.system.threats);
		threats[threatIndex].consequences = threats[threatIndex].consequences
			.filter(
				(_, i) => i !== consequenceIndex,
			);
		await this.document.update({ "system.threats": threats });
	}
}
