import { error } from "../../logger.js";
import { LitmItemSheet } from "../../sheets/base-item-sheet.js";
import {
	enrichHTML,
	fellowshipTagEffect,
	findThemebookByName,
	powerTagEffect,
	queryItemsFromPacks,
	toQuestionOptions,
	weaknessTagEffect,
} from "../../utils.js";

/**
 * Theme sheet for Legend in the Mist
 * Represents a character's Origin, Adventure, or Greatness theme
 */
export class ThemeSheet extends LitmItemSheet {
	/** @override */
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm-theme-sheet"],
		tag: "form",
		position: {
			width: 600,
			height: "auto",
		},
		actions: {
			addTag: ThemeSheet.#onAddTag,
			removeTag: ThemeSheet.#onRemoveTag,
			adjustProgress: ThemeSheet.#onAdjustProgress,
			addSpecialImprovement: ThemeSheet.#onAddSpecialImprovement,
			removeSpecialImprovement: ThemeSheet.#onRemoveSpecialImprovement,
		},
		form: {
			submitOnChange: true,
			closeOnSubmit: false,
			handler: ThemeSheet._onSubmitFormWithEffects,
		},
		window: {
			icon: "fa-solid fa-book",
			resizable: true,
		},
	};

	/** @override */
	static PARTS = {
		form: {
			template: "systems/litmv2/templates/item/theme.html",
			scrollable: [""],
		},
	};

	/* -------------------------------------------- */
	/*  Rendering                                   */
	/* -------------------------------------------- */

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		// Computed properties
		const levels = CONFIG.litmv2.theme_levels
			? Object.keys(CONFIG.litmv2.theme_levels).reduce((acc, level) => {
				acc[level] = game.i18n.localize(`LITM.Terms.${level}`);
				return acc;
			}, {})
			: {};

		const themebooks = await this.#getThemebookOptions();
		const selectedThemebook = await findThemebookByName(this.system.themebook);
		const allPowerQuestions = selectedThemebook?.system?.powerTagQuestions ||
			[];
		const allWeaknessQuestions =
			selectedThemebook?.system?.weaknessTagQuestions || [];
		const powerQuestionOptions = toQuestionOptions(
			allPowerQuestions,
			1, // Skip first question (reserved for theme tag)
		);
		const weaknessQuestionOptions = toQuestionOptions(
			allWeaknessQuestions,
			0, // Start from first question
		);

		const powerQuestionTexts = Object.fromEntries(
			allPowerQuestions
				.map((q, i) => [String(i), q])
				.filter(([i, q]) => Number(i) > 0 && `${q ?? ""}`.trim()),
		);
		const weaknessQuestionTexts = Object.fromEntries(
			allWeaknessQuestions
				.map((q, i) => [String(i), q])
				.filter(([, q]) => `${q ?? ""}`.trim()),
		);

		const enrichedDescription = await enrichHTML(
			this.system.description,
			this.document,
		);

		// Theme tag question (Question A) for placeholder
		const themeTagQuestion = `${allPowerQuestions[0] ?? ""}`.trim();

		return {
			...context,
			enriched: {
				description: enrichedDescription,
			},
			// Document data
			item: this.document,
			system: this.system,

			// Computed properties
			powerTags: this.system.powerTags,
			weaknessTags: this.system.weaknessTags,
			levels,
			themebooks,
			powerQuestionOptions,
			weaknessQuestionOptions,
			powerQuestionTexts,
			weaknessQuestionTexts,
			themeTagQuestion,

			// Display data
			title: this.document.name,
		};
	}

	/* -------------------------------------------- */
	/*  Form Handling                               */
	/* -------------------------------------------- */

	async #getThemebookOptions() {
		const entries = await queryItemsFromPacks({
			type: "themebook",
			category: "themebooks",
			indexFields: ["system.theme_level", "system.isFellowship"],
			map: (item) => ({
				name: item.name,
				level: item.system?.theme_level,
				isFellowship: item.system?.isFellowship ?? false,
			}),
		});

		// Filter by level (with fallback to all if no level match)
		const matchingLevel = entries.filter(
			(item) =>
				!item.level ||
				item.level === "variable" ||
				item.level === this.system.level,
		);
		const byLevel = matchingLevel.length ? matchingLevel : entries;

		// Filter by fellowship status (strict - no fallback)
		const finalSource = byLevel.filter(
			(item) => item.isFellowship === this.system.isFellowship,
		);

		const seen = new Set();
		const options = [];
		for (const item of finalSource) {
			if (!item.name || seen.has(item.name)) continue;
			seen.add(item.name);
			options.push({
				value: item.name,
				label: item.name,
			});
		}

		if (
			this.system.themebook &&
			!options.some((option) => option.value === this.system.themebook)
		) {
			options.unshift({
				value: this.system.themebook,
				label: this.system.themebook,
			});
		}

		return options;
	}

	/* -------------------------------------------- */
	/*  Event Handlers & Actions                    */
	/* -------------------------------------------- */

	/**
	 * Add a new tag to the theme
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onAddTag(_event, target) {
		if (!this.document.isOwner) return;
		const tagType = target.dataset.type;
		const themebook = await findThemebookByName(this.system.themebook);
		const isActive = this.document.isEmbedded;

		const existingTags = tagType === "power_tag" ? this.system.powerTags : this.system.weaknessTags;
		const usedQuestions = new Set(existingTags.map((t) => t.system?.question).filter(Boolean));
		const allQuestions = tagType === "power_tag"
			? (themebook?.system?.powerTagQuestions || [])
			: (themebook?.system?.weaknessTagQuestions || []);
		const startIndex = tagType === "power_tag" ? 1 : 0;
		const nextQuestion = allQuestions
			.map((q, i) => ({ q, i }))
			.filter(({ q, i }) => i >= startIndex && `${q ?? ""}`.trim() && !usedQuestions.has(String(i)))
			.map(({ i }) => String(i))[0] ?? null;

		const isFellowship = this.document.system.isFellowship;
		const factory = tagType === "weakness_tag" ? weaknessTagEffect
			: isFellowship ? fellowshipTagEffect
			: powerTagEffect;
		await this.document.createEmbeddedDocuments("ActiveEffect", [
			factory({ question: nextQuestion, isActive }),
		]);
	}

	/**
	 * Remove a tag from the theme
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

	/**
	 * Add a special improvement to the theme
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onAddSpecialImprovement(_event, _target) {
		const specialImprovements = [...(this.system.specialImprovements || [])];
		specialImprovements.push({
			name: "",
			description: "",
			isActive: false,
		});
		await this.document.update({
			"system.specialImprovements": specialImprovements,
		});
	}

	/**
	 * Remove a special improvement from the theme
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onRemoveSpecialImprovement(_event, target) {
		const index = parseInt(target.dataset.index, 10);
		if (Number.isNaN(index)) return;
		const specialImprovements = [...(this.system.specialImprovements || [])];
		specialImprovements.splice(index, 1);
		await this.document.update({
			"system.specialImprovements": specialImprovements,
		});
	}

	/**
	 * Adjust a progress track
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onAdjustProgress(event, target) {
		event.preventDefault();
		event.stopPropagation();

		const button = target.closest("button");
		if (!button) return;

		const boxIndex = parseInt(button.dataset.index, 10);
		if (Number.isNaN(boxIndex)) return;

		const container = button.closest(".progress-buttons");
		if (!container) return;

		const field = container.dataset.id;
		if (!field) return;

		const currentValue = foundry.utils.getProperty(this.document, field);

		let newValue;
		if (currentValue === boxIndex + 1) {
			newValue = boxIndex;
		} else {
			newValue = boxIndex + 1;
		}

		try {
			await this.document.update({ [field]: newValue });
		} catch (err) {
			error("Error updating progress track:", err);
		}
	}
}
