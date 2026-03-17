import { enrichHTML } from "../utils.js";

const { ItemSheetV2 } = foundry.applications.sheets;
const { HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Base item sheet class for Legend in the Mist
 * Provides common functionality for all item sheet types
 */
export class LitmItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
	/** Whether to suppress the next change-triggered form submit (set by pointerdown pre-submit) */
	_suppressNextChange = false;

	/** @override */
	_onChangeForm(formConfig, event) {
		if (this._suppressNextChange) {
			this._suppressNextChange = false;
			return;
		}
		super._onChangeForm(formConfig, event);
	}

	/** @override */
	async _onFirstRender(context, options) {
		await super._onFirstRender(context, options);

		// Prevent click from firing (per Pointer Events spec, preventDefault on
		// pointerdown suppresses the subsequent click). We submit the form and
		// execute the action manually, since rAF-deferred renders still fire
		// before the click event in practice.
		this.element.addEventListener(
			"pointerdown",
			(event) => {
				const actionBtn = event.target.closest("[data-action]");
				if (!actionBtn) return;

				const form = this.form;
				if (!form) return;

				const focused = document.activeElement;
				if (!focused || !form.contains(focused)) return;
				if (!["INPUT", "TEXTAREA", "SELECT"].includes(focused.tagName)) return;

				event.preventDefault();

				const action = actionBtn.dataset.action;
				const dataset = { ...actionBtn.dataset };

				this._suppressNextChange = true;
				this.submit()
					.then(() => {
						const handler = this.options.actions[action];
						const fn = typeof handler === "object" ? handler.handler : handler;
						if (!fn) return;
						const syntheticTarget = document.createElement("button");
						Object.assign(syntheticTarget.dataset, dataset);
						fn.call(this, event, syntheticTarget);
					})
					.catch(console.error);
			},
			{ capture: true },
		);
	}

	/**
	 * Convenient reference to the item's system data
	 * @type {TypeDataModel}
	 * @protected
	 */
	get system() {
		return this.document.system;
	}

	/**
	 * Enrich HTML field for display
	 * @param {string} text          The HTML text to enrich
	 * @param {Document} document    The document context for enrichment
	 * @returns {Promise<string>}
	 * @protected
	 */
	static async _enrichHTML(text, document) {
		return enrichHTML(text, document);
	}

	/**
	 * Enrich multiple HTML fields at once
	 * @param {Object<string, string>} fields   Object mapping field names to text
	 * @param {Document} document               The document context for enrichment
	 * @returns {Promise<Object<string, string>>}
	 * @protected
	 */
	static async _enrichHTMLFields(fields, document) {
		const enriched = {};
		for (const [key, value] of Object.entries(fields)) {
			enriched[key] = await this._enrichHTML(value, document);
		}
		return enriched;
	}
}
