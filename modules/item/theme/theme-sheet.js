import {
	fellowshipTagEffect,
	powerTagEffect,
	weaknessTagEffect,
} from "../../active-effects/effect-factories.js";
import { error } from "../../logger.js";
import { LitmItemSheet } from "../../sheets/base-item-sheet.js";
import { getThemeLevels } from "../../system/config.js";
import {
	availableThemebookImprovements,
	findThemebookByName,
	queryItemsFromPacks,
	toQuestionOptions,
} from "../../utils.js";

/** Maps tag type + fellowship context to the correct effect factory. */
const TAG_FACTORIES = {
	weakness_tag: () => weaknessTagEffect,
	power_tag: (isFellowship) =>
		isFellowship ? fellowshipTagEffect : powerTagEffect,
};

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
			addSpecialImprovementFromThemebook:
				ThemeSheet.#onAddSpecialImprovementFromThemebook,
			removeSpecialImprovement: ThemeSheet.#onRemoveSpecialImprovement,
			setLevel: ThemeSheet.#onSetLevel,
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
			templates: [
				"systems/litmv2/templates/partials/edit-linked-ref-controls.html",
			],
		},
	};

	/* -------------------------------------------- */
	/*  Rendering                                   */
	/* -------------------------------------------- */

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		// Computed properties
		const levelOptions = getThemeLevels().map((level) => ({
			value: level,
			label: game.i18n.localize(`LITM.Terms.${level}`),
			selected: level === this.system.level,
		}));

		const { options: themebooks, levels: themebookLevels } =
			await this.#getThemebookOptions();
		const selectedThemebook = await findThemebookByName(this.system.themebook);
		const allPowerQuestions =
			selectedThemebook?.system?.powerTagQuestions || [];
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

		const enriched = await this._enrichFields("description");

		// Theme tag question (Question A) for placeholder
		const themeTagQuestion = `${allPowerQuestions[0] ?? ""}`.trim();

		const availableSpecialImprovements = availableThemebookImprovements(
			this.system.specialImprovements,
			selectedThemebook?.system?.specialImprovements ?? [],
		);

		return {
			...context,
			enriched,
			// Document data
			item: this.document,
			system: this.system,

			// Computed properties
			powerTags: this.system.powerTags,
			weaknessTags: this.system.weaknessTags,
			levelOptions,
			themebooks,
			themebookLevels,
			powerQuestionOptions,
			weaknessQuestionOptions,
			powerQuestionTexts,
			weaknessQuestionTexts,
			themeTagQuestion,
			availableSpecialImprovements,

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
		const levels = {};
		for (const item of finalSource) {
			if (!item.name || seen.has(item.name)) continue;
			seen.add(item.name);
			options.push({
				value: item.name,
				label: item.name,
			});
			levels[item.name] = item.level ?? "";
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

		return { options, levels };
	}

	/** @override */
	_onRender(context, options) {
		super._onRender(context, options);
		const html = this.element;
		if (!html) return;

		const themebookSelect = html.querySelector(
			"select[name='system.themebook']",
		);
		if (themebookSelect && context?.themebookLevels) {
			themebookSelect.addEventListener("change", (ev) => {
				const level = context.themebookLevels[ev.target.value];
				if (!level || level === "variable") return;
				if (level === this.system.level) return;
				this.document.update({ "system.level": level });
			});
		}
	}

	/* -------------------------------------------- */
	/*  Event Handlers & Actions                    */
	/* -------------------------------------------- */

	/**
	 * Update the theme's might tier from the icon picker.
	 * @private
	 */
	static async #onSetLevel(_event, target) {
		const level = target?.dataset?.level;
		if (!level || level === this.system.level) return;
		await this.document.update({ "system.level": level });
	}

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

		const question = this.document.system.nextAvailableQuestion(
			tagType,
			themebook,
		);

		const isFellowship = this.document.system.isFellowship;
		const factory = (TAG_FACTORIES[tagType] ?? TAG_FACTORIES.power_tag)(
			isFellowship,
		);
		await this.document.createEmbeddedDocuments("ActiveEffect", [
			factory({ question, isActive }),
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
	 * Copy a special improvement entry from the linked themebook onto this theme.
	 * @private
	 */
	static async #onAddSpecialImprovementFromThemebook(_event, target) {
		const index = Number.parseInt(target.dataset.index, 10);
		if (!Number.isFinite(index)) return;
		const themebook = await findThemebookByName(this.system.themebook);
		const entry = themebook?.system?.specialImprovements?.[index];
		if (!entry) return;
		const claimed = this.system.specialImprovements;
		if (
			claimed.some(
				(c) => c.name === entry.name && c.description === entry.description,
			)
		)
			return;
		await this.document.update({
			"system.specialImprovements": [
				...claimed,
				{
					name: entry.name || "",
					description: entry.description || "",
					isActive: true,
				},
			],
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
