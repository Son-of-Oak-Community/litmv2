import { LitmItemSheet } from "../../sheets/base-item-sheet.js";
import { enrichHTML } from "../../utils.js";

export class ThemebookSheet extends LitmItemSheet {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm-themebook-sheet"],
		tag: "form",
		position: {
			width: 700,
			height: "auto",
		},
		actions: {
			addEntry: ThemebookSheet.#onAddEntry,
			removeEntry: ThemebookSheet.#onRemoveEntry,
			setLevel: ThemebookSheet.#onSetLevel,
		},
		window: {
			icon: "fa-solid fa-book-open",
			resizable: true,
			controls: [],
		},
		form: {
			submitOnChange: true,
			closeOnSubmit: false,
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/item/themebook.html",
			scrollable: [""],
		},
	};

	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		const enrichedDescription = await enrichHTML(
			this.system.description,
			this.document,
		);

		const toLabeledList = (items = []) =>
			items.map((question, index) => ({
				index,
				question,
				label: index < 26 ? String.fromCharCode(65 + index) : `${index + 1}`,
			}));

		const themeLevelKeys = ["origin", "adventure", "greatness", "variable"];
		const currentLevel = this.system.theme_level || "origin";

		return {
			...context,
			enriched: {
				description: enrichedDescription,
			},
			levels: {
				origin: game.i18n.localize("LITM.Terms.origin"),
				adventure: game.i18n.localize("LITM.Terms.adventure"),
				greatness: game.i18n.localize("LITM.Terms.greatness"),
				variable: game.i18n.localize("LITM.Terms.variable"),
			},
			levelOptions: themeLevelKeys.map((key) => ({
				value: key,
				label: game.i18n.localize(`LITM.Terms.${key}`),
				selected: key === currentLevel,
			})),
			powerTagQuestions: toLabeledList(this.system.powerTagQuestions),
			weaknessTagQuestions: toLabeledList(this.system.weaknessTagQuestions),
			system: this.system,
			item: this.document,
		};
	}

	static async #onSetLevel(_event, target) {
		const level = target?.dataset?.level;
		if (!level || level === this.system.theme_level) return;
		await this.document.update({ "system.theme_level": level });
	}

	static async #onAddEntry(_event, target) {
		const path = target.dataset.path;
		if (!path) return;

		const values = foundry.utils.getProperty(this.document, path) || [];

		let defaultEntry = "";
		if (path === "system.specialImprovements") {
			defaultEntry = {
				name: "",
				description: "",
			};
		}

		await this.document.update({ [path]: [...values, defaultEntry] });
	}

	static async #onRemoveEntry(_event, target) {
		const path = target.dataset.path;
		const index = Number(target.dataset.index);
		if (!path || Number.isNaN(index)) return;

		const values = foundry.utils.getProperty(this.document, path) || [];
		const next = [...values];
		next.splice(index, 1);
		await this.document.update({ [path]: next });
	}
}
