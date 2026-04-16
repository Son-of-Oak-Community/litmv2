import { LitmItemSheet } from "../../sheets/base-item-sheet.js";
import { localize as t, powerTagEffect, weaknessTagEffect } from "../../utils.js";

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
			handler: StoryThemeSheet._onSubmitFormWithEffects,
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

		const enriched = await this._enrichFields("description");
		return {
			...context,
			enriched,
			system: this.system,
			item: this.document,
			levels: Object.fromEntries(
				Object.keys(CONFIG.litmv2.theme_levels || {}).map((k) => [k, t(`LITM.Terms.${k}`)]),
			),
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
		if (!this.document.isOwner) return;
		const tagType = target.dataset.type; // "power_tag" or "weakness_tag"
		const factory = tagType === "weakness_tag" ? weaknessTagEffect : powerTagEffect;
		await this.document.createEmbeddedDocuments("ActiveEffect", [
			factory({ isActive: true }),
		]);
	}

	/**
	 * Remove a tag from the story theme
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onRemoveTag(_event, target) {
		if (!this.document.isOwner) return;
		const effectId = target.dataset.effectId;
		if (!effectId) return;
		await this.document.deleteEmbeddedDocuments("ActiveEffect", [effectId]);
		this.document.parent?.sheet?._notifyStoryTags?.();
	}

}
