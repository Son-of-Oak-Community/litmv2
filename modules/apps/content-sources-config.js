import { ContentSources, WORLD_SOURCE_ID } from "../system/content-sources.js";
import { LitmSettings } from "../system/settings.js";
import { localize as t } from "../utils.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ContentSourcesConfig extends HandlebarsApplicationMixin(
	ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "content-sources-config",
		tag: "form",
		window: {
			title: "LITM.Settings.content_sources",
			icon: "fas fa-atlas",
			contentClasses: ["standard-form"],
		},
		position: {
			width: 560,
			height: 720,
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
		{
			category: "themebooks",
			labelKey: "LITM.Settings.content_sources_themebooks",
		},
		{
			category: "themekits",
			labelKey: "LITM.Settings.content_sources_themekits",
		},
		{
			category: "tropes",
			labelKey: "LITM.Settings.content_sources_tropes",
		},
		{
			category: "statuses",
			labelKey: "LITM.Settings.content_sources_statuses",
		},
	];

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		context.sections = ContentSourcesConfig.CATEGORIES.map(
			({ category, labelKey }) => {
				const selected = new Set(LitmSettings.getCompendiumSetting(category));
				const packs = ContentSources.getCandidatePacks(category)
					.map((p) => {
						const checked = selected.has(p.collection);
						const { gmOnly, trustedOnly } =
							ContentSourcesConfig.#packPlayerAccess(p);
						return {
							id: p.collection,
							label: p.metadata.label,
							source: ContentSourcesConfig.#sourceTitle(p),
							checked,
							hidden: gmOnly || trustedOnly,
							// A GM-only pack can't feed player-facing pickers, so it
							// can't be newly selected — but a stale selection stays
							// toggleable so it can still be unticked.
							disabled: gmOnly && !checked,
							tooltip: gmOnly
								? "LITM.Settings.content_sources_gm_only"
								: trustedOnly
									? "LITM.Settings.content_sources_trusted_only"
									: null,
						};
					})
					.sort((a, b) => a.label.localeCompare(b.label, game.i18n.lang));
				const isStatuses = category === "statuses";
				// World items are a selectable source for Item categories; statuses
				// live only in ActiveEffect packs, so they get no World row.
				if (!isStatuses) {
					packs.unshift({
						id: WORLD_SOURCE_ID,
						label: t("LITM.Settings.content_sources_world"),
						source: t("LITM.Settings.content_sources_source_world"),
						checked: selected.has(WORLD_SOURCE_ID),
					});
				}
				return {
					category,
					label: t(labelKey),
					packs,
					hasSelection: packs.some((p) => p.checked),
					isStatuses,
				};
			},
		);

		context.buttons = [
			{ type: "submit", icon: "fas fa-save", label: "SETTINGS.Save" },
		];

		return context;
	}

	/**
	 * Human-readable title of the package a pack ships with — the module or
	 * system title instead of its raw package id, "World" for world packs.
	 * @param {CompendiumCollection} pack
	 * @returns {string}
	 */
	static #sourceTitle(pack) {
		const { packageType, packageName } = pack.metadata;
		switch (packageType) {
			case "world":
				return t("LITM.Settings.content_sources_source_world");
			case "system":
				return game.system.title;
			default:
				return game.modules.get(packageName)?.title || packageName;
		}
	}

	/**
	 * Classify a pack's visibility to non-GM users from its ownership config.
	 * Roles are hierarchical: a PLAYER grant reaches trusted players too, but a
	 * TRUSTED grant leaves regular players without access.
	 * @param {CompendiumCollection} pack
	 * @returns {{ gmOnly: boolean, trustedOnly: boolean }} `gmOnly` — no non-GM
	 *   role can observe the pack; `trustedOnly` — trusted players can, regular
	 *   players can't.
	 */
	static #packPlayerAccess(pack) {
		const levels = CONST.DOCUMENT_OWNERSHIP_LEVELS;
		const level = (role) => levels[pack.ownership[role]] ?? levels.NONE;
		const playerSees = level("PLAYER") >= levels.OBSERVER;
		const trustedSees = playerSees || level("TRUSTED") >= levels.OBSERVER;
		return { gmOnly: !trustedSees, trustedOnly: trustedSees && !playerSees };
	}

	/**
	 * Collect checked checkboxes per category and save to settings.
	 * @this {ContentSourcesConfig}
	 */
	static async #onSubmit(_event, form, _formData) {
		const categories = ["themebooks", "themekits", "tropes", "statuses"];
		for (const category of categories) {
			const checked = [
				...form.querySelectorAll(`input[name="${category}"]:checked`),
			].map((el) => el.value);
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
