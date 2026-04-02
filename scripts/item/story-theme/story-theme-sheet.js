import { LitmItemSheet } from "../../sheets/base-item-sheet.js";
import { enrichHTML } from "../../utils.js";

export class StoryThemeSheet extends LitmItemSheet {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm-story-theme-sheet"],
		tag: "form",
		position: {
			width: 600,
			height: "auto",
		},
		actions: {
			addPowerTag: StoryThemeSheet.#onAddTag,
			removePowerTag: StoryThemeSheet.#onRemoveTag,
		},
		form: {
			submitOnChange: true,
			closeOnSubmit: false,
			handler: StoryThemeSheet._onSubmitForm,
		},
		window: {
			icon: "fa-solid fa-book-open",
			resizable: true,
			controls: [],
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/item/story-theme.html",
			scrollable: [""],
		},
	};

	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		const enrichedDescription = await enrichHTML(
			this.system.description,
			this.document,
		);
		return {
			...context,
			enriched: {
				description: enrichedDescription,
			},
			system: this.system,
			item: this.document,
			levels: this.system.levels,
			powerTags: this.system.powerTags,
			weaknessTags: this.system.weaknessTags,
		};
	}

	/**
	 * Add a new tag to the story theme
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onAddTag(_event, target) {
		const tagType = target.dataset.type; // "powerTag" or "weaknessTag"
		await this.document.createEmbeddedDocuments("ActiveEffect", [{
			name: "",
			type: "theme_tag",
			disabled: false, // Story theme tags start active
			system: {
				tagType,
				question: null,
				isScratched: false,
				isSingleUse: false,
			},
		}]);
	}

	/**
	 * Remove a tag from the story theme
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onRemoveTag(_event, target) {
		const effectId = target.dataset.effectId;
		if (!effectId) return;
		await this.document.deleteEmbeddedDocuments("ActiveEffect", [effectId]);
	}

	static async _onSubmitForm(_event, _form, formData) {
		const submitData = formData.object;
		const effectMap = {};

		for (const [key, value] of Object.entries(submitData)) {
			if (!key.startsWith("effects.")) continue;
			delete submitData[key];
			const parts = key.split(".");
			const effectId = parts[1];
			const field = parts.slice(2).join(".");
			effectMap[effectId] ??= {};
			foundry.utils.setProperty(effectMap[effectId], field, value);
		}

		const effectUpdates = [];
		for (const [id, data] of Object.entries(effectMap)) {
			const update = { _id: id };
			if ("name" in data) update.name = data.name;
			if ("isActive" in data) update.disabled = !data.isActive;
			if (data.system) update.system = data.system;
			effectUpdates.push(update);
		}

		if (effectUpdates.length) {
			await this.document.updateEmbeddedDocuments("ActiveEffect", effectUpdates);
		}
		await this.document.update(submitData);
	}
}
