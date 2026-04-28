/**
 * Read-only embed popout — displays a document's `@render` card in a small
 * window so players can read what an action / vignette / etc. does without
 * opening the editor sheet.
 *
 * Usage:
 *   new LitmEmbedPopout({ document, render }).render(true)
 *
 * Where `render` is a renderer function that returns an HTMLElement.
 */
const { ApplicationV2 } = foundry.applications.api;

export class LitmEmbedPopout extends ApplicationV2 {
	/** @override */
	static DEFAULT_OPTIONS = {
		id: "litm-embed-popout-{id}",
		classes: ["litm", "litm-embed-popout"],
		tag: "section",
		position: {
			width: 480,
			height: 640,
		},
		window: {
			icon: "fa-solid fa-book-open",
			resizable: true,
		},
	};

	#doc = null;
	#render = null;

	constructor({ document, render, ...rest } = {}) {
		super({
			...rest,
			id: `litm-embed-popout-${document?.id ?? foundry.utils.randomID()}`,
		});
		this.#doc = document;
		this.#render = render;
	}

	/** @override */
	get title() {
		return this.#doc?.name ?? "";
	}

	/** @override */
	async _renderHTML(_context, _options) {
		const node = await this.#render(this.#doc);
		return node;
	}

	/** @override */
	_replaceHTML(result, content, _options) {
		content.replaceChildren(result);
	}
}
