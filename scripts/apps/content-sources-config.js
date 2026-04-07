import { localize as t } from "../utils.js";
import { LitmSettings } from "../system/settings.js";
import { ContentSources } from "../system/content-sources.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ContentSourcesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "content-sources-config",
		tag: "form",
		window: {
			title: "LITM.Settings.content_sources",
			icon: "fas fa-atlas",
			contentClasses: ["standard-form"],
		},
		position: {
			width: 480,
			height: 500,
		},
		form: {
			closeOnSubmit: true,
			handler: ContentSourcesConfig.#onSubmit,
		},
		actions: {
			resetStatuses: ContentSourcesConfig.#onResetStatuses,
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/apps/content-sources-config.html",
			scrollable: [".scrollable"],
		},
		footer: {
			template: "templates/generic/form-footer.hbs",
		},
	};

	static CATEGORIES = [
		{ category: "themebooks", docType: "Item", labelKey: "LITM.Settings.content_sources_themebooks" },
		{ category: "themekits", docType: "Item", labelKey: "LITM.Settings.content_sources_themekits" },
		{ category: "tropes", docType: "Item", labelKey: "LITM.Settings.content_sources_tropes" },
		{ category: "statuses", docType: "ActiveEffect", labelKey: "LITM.Settings.content_sources_statuses" },
	];

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		context.sections = ContentSourcesConfig.CATEGORIES.map(({ category, docType, labelKey }) => {
			const selected = new Set(LitmSettings.getCompendiumSetting(category));
			const packs = game.packs
				.filter((p) => p.documentName === docType)
				.map((p) => ({
					id: p.collection,
					label: p.metadata.label,
					source: p.metadata.packageName || "world",
					checked: selected.has(p.collection),
				}));
			return {
				category,
				label: t(labelKey),
				packs,
				hasSelection: packs.some((p) => p.checked),
				isStatuses: category === "statuses",
			};
		});

		context.buttons = [
			{ type: "submit", icon: "fas fa-save", label: "SETTINGS.Save" },
		];

		return context;
	}

	/**
	 * Collect checked checkboxes per category and save to settings.
	 * @this {ContentSourcesConfig}
	 */
	static async #onSubmit(event, form, formData) {
		const categories = ["themebooks", "themekits", "tropes", "statuses"];
		for (const category of categories) {
			const checked = [...form.querySelectorAll(`input[name="${category}"]:checked`)]
				.map((el) => el.value);
			await LitmSettings.setCompendiumSetting(category, checked);
		}
	}

	/**
	 * Reset statuses to defaults after confirmation.
	 * @this {ContentSourcesConfig}
	 */
	static async #onResetStatuses() {
		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: { title: t("LITM.Settings.content_sources_reset_statuses") },
			content: t("LITM.Settings.content_sources_reset_confirm"),
		});
		if (!confirmed) return;
		await ContentSources.resetStatuses();
		this.render();
	}
}
