import { renderThemebook } from "../system/renderers/themebook-renderer.js";
import { renderTheme } from "../system/renderers/theme-renderer.js";
import { error } from "../logger.js";
import { localize as t } from "../utils.js";
import {
	catalogLevels,
	filterThemeCatalog,
	loadThemeCatalog,
} from "./theme-catalog.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Browse the theme kits and themebooks in the configured content sources.
 * Cards filter by text, kind and Might, expand to a preview, and drag like a
 * sidebar entry. Given an `onPick` callback, each card also gets a button
 * that hands its catalog entry to the caller — that is how the evolution
 * wizard uses it. Replaceable as `game.litmv2.ThemeBrowser`.
 */
export class ThemeBrowser extends HandlebarsApplicationMixin(ApplicationV2) {
	/** @type {import("./theme-catalog.js").ThemeCatalogEntry[]|null} */
	#catalog = null;
	#filters = { text: "", kind: "", level: "" };
	/** Expanded card uuid → preview HTML ("" while loading). */
	#previews = new Map();
	#isFellowship;
	#pickCallback;
	#pickLabel;
	#subtitle;

	/**
	 * @param {object} [options]
	 * @param {boolean} [options.isFellowship=false]  List Fellowship themes
	 *   instead of Hero themes
	 * @param {(entry: object) => (boolean|void|Promise<boolean|void>)} [options.onPick]
	 *   Called with the picked catalog entry; return false to keep the
	 *   browser open
	 * @param {string} [options.pickLabel]  Label for the pick button
	 * @param {string} [options.subtitle]   Shown under the filters
	 */
	constructor(options = {}) {
		const { isFellowship = false, onPick, pickLabel, subtitle, ...rest } =
			options;
		super(rest);
		this.#isFellowship = isFellowship;
		this.#pickCallback = onPick ?? null;
		this.#pickLabel = pickLabel ?? t("LITM.Ui.theme_browser_pick");
		this.#subtitle = subtitle ?? "";
	}

	/** @override */
	static DEFAULT_OPTIONS = {
		id: "litm-theme-browser-{id}",
		classes: ["litm", "litm-theme-browser"],
		tag: "section",
		position: { width: 520, height: 640 },
		window: {
			title: "LITM.Ui.theme_browser_title",
			icon: "fa-solid fa-book-open",
			resizable: true,
		},
		actions: {
			togglePreview: ThemeBrowser.#onTogglePreview,
			pick: ThemeBrowser.#onPick,
		},
	};

	/** @override */
	static PARTS = {
		body: {
			template: "systems/litmv2/templates/apps/theme-browser.html",
			scrollable: [".litm--theme-browser-list"],
		},
	};

	/** @override */
	async _prepareContext(_options) {
		this.#catalog ??= await loadThemeCatalog({
			isFellowship: this.#isFellowship,
		});
		const { text, kind, level } = this.#filters;
		const shown = filterThemeCatalog(this.#catalog, this.#filters);
		return {
			subtitle: this.#subtitle,
			canPick: !!this.#pickCallback,
			pickLabel: this.#pickLabel,
			filterText: text,
			anyLevel: !level,
			kindOptions: [
				{ value: "", label: t("LITM.Ui.theme_browser_all") },
				{ value: "kit", label: t("LITM.Terms.themekits") },
				{ value: "book", label: t("LITM.Terms.themebooks") },
			].map((o) => ({ ...o, active: o.value === kind })),
			levelOptions: catalogLevels(this.#catalog).map((value) => ({
				value,
				label: t(`LITM.Terms.${value}`),
				active: value === level,
			})),
			totalCount: this.#catalog.length,
			entries: shown.map((e) => ({
				...e,
				kindLabel: t(e.kind === "kit" ? "LITM.Ui.theme_kit" : "LITM.Terms.themebook"),
				levelLabel: e.level ? t(`LITM.Terms.${e.level}`) : "",
				// Kits usually use their Might icon as their image; don't show it twice.
				showLevelIcon: !!e.level && !e.img?.endsWith(`/${e.level}.svg`),
				expanded: this.#previews.has(e.uuid),
				preview: this.#previews.get(e.uuid) ?? "",
			})),
		};
	}

	/** @override */
	async _onRender(context, options) {
		await super._onRender(context, options);
		const html = this.element;

		const search = html.querySelector("[data-filter='text']");
		search?.addEventListener("input", (event) => {
			this.#filters.text = event.currentTarget.value;
			this.render();
		});
		// Typing re-renders the list; keep the caret in the search box.
		if (search && this.#filters.text && document.activeElement !== search) {
			const end = search.value.length;
			search.focus();
			search.setSelectionRange(end, end);
		}

		// Radios are the filters' only event path: a change fires for a click
		// and for the keyboard alike.
		for (const name of ["kind", "level"]) {
			for (const input of html.querySelectorAll(`input[name='${name}']`)) {
				input.addEventListener("change", (event) => {
					this.#filters[name] = event.currentTarget.value;
					this.render();
				});
			}
		}

		// Cards drag like a sidebar entry, so any sheet or app that accepts an
		// Item drop accepts them.
		for (const card of html.querySelectorAll("[data-uuid][draggable='true']")) {
			card.addEventListener("dragstart", (event) => {
				event.dataTransfer.setData(
					"text/plain",
					JSON.stringify({ type: "Item", uuid: card.dataset.uuid }),
				);
			});
		}
	}

	/** The catalog entry a clicked control belongs to. */
	#entryFor(target) {
		const uuid = target.closest("[data-uuid]")?.dataset.uuid;
		return this.#catalog?.find((e) => e.uuid === uuid) ?? null;
	}

	static async #onTogglePreview(_event, target) {
		const entry = this.#entryFor(target);
		if (!entry) return;
		if (this.#previews.has(entry.uuid)) {
			this.#previews.delete(entry.uuid);
			return this.render();
		}
		this.#previews.set(entry.uuid, "");
		this.render();
		try {
			const doc = await foundry.utils.fromUuid(entry.uuid);
			const card = doc
				? entry.kind === "kit"
					? renderTheme(doc)
					: await renderThemebook(doc)
				: null;
			this.#previews.set(entry.uuid, card?.outerHTML ?? "");
		} catch (err) {
			error(`ThemeBrowser: preview failed for ${entry.uuid}`, err);
			this.#previews.delete(entry.uuid);
		}
		this.render();
	}

	static async #onPick(_event, target) {
		const entry = this.#entryFor(target);
		if (!entry || !this.#pickCallback) return;
		const keepOpen = (await this.#pickCallback(entry)) === false;
		if (!keepOpen) this.close();
	}

}
