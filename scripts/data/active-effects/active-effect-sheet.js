import { localize as t } from "../../utils.js";

const { DocumentSheetV2, HandlebarsApplicationMixin } =
	foundry.applications.api;

const ALL_TYPES = [
	"power_tag",
	"weakness_tag",
	"fellowship_tag",
	"relationship_tag",
	"story_tag",
	"status_tag",
];

/** Maps effect type → CSS variable name for the accent color. */
const TYPE_COLOR_VAR = {
	power_tag: "--color-litm-tag",
	weakness_tag: "--color-litm-weakness",
	fellowship_tag: "--color-litm-tag",
	relationship_tag: "--color-litm-tag",
	story_tag: "--color-litm-tag",
	status_tag: "--color-litm-status",
};

/**
 * Simplified ActiveEffect sheet for Legend in the Mist tags and statuses.
 * Shows only the fields relevant to the system instead of the full Foundry
 * effect config (changes, duration, etc.).
 */
export class LitmActiveEffectSheet extends HandlebarsApplicationMixin(
	DocumentSheetV2,
) {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm-active-effect-sheet"],
		tag: "form",
		position: {
			width: 350,
			height: "auto",
		},
		form: {
			handler: LitmActiveEffectSheet.#onSubmit,
			submitOnChange: true,
			closeOnSubmit: false,
		},
		window: {
			icon: "fa-solid fa-tag",
			resizable: false,
		},
	};

	static PARTS = {
		form: {
			template:
				"systems/litmv2/templates/effect/active-effect-sheet.html",
		},
	};

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const effect = this.document;
		const colorVar = TYPE_COLOR_VAR[effect.type] ?? "--color-litm-tag";

		return {
			...context,
			effect,
			system: effect.system,
			source: effect.toObject(),
			typeLabel: t(`TYPES.ActiveEffect.${effect.type}`),
			accentVar: colorVar,
			isActive: !effect.disabled,
			isStoryTag: effect.type === "story_tag",
			isStatusTag: effect.type === "status_tag",
			hasQuestion:
				"question" in (effect.system ?? {}),
			hasScratched:
				"isScratched" in (effect.system ?? {}),
			hasTitleTag:
				"isTitleTag" in (effect.system ?? {}),
		};
	}

	static async #onSubmit(_event, _form, formData) {
		const data = formData.object;
		// "Active" checkbox is the inverse of the stored "disabled" field
		if ("isActive" in data) {
			data.disabled = !data.isActive;
			delete data.isActive;
		}
		await this.document.update(data);
	}

	/**
	 * Register this sheet for all system ActiveEffect types.
	 */
	static register() {
		const { DocumentSheetConfig } = foundry.applications.apps;
		DocumentSheetConfig.registerSheet(
			foundry.documents.ActiveEffect,
			"litmv2",
			LitmActiveEffectSheet,
			{
				types: ALL_TYPES,
				makeDefault: true,
				label: "LITM.Sheets.active_effect",
			},
		);
	}
}
