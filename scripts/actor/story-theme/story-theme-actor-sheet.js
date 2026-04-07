import { LitmActorSheet } from "../../sheets/base-actor-sheet.js";
import { enrichHTML, levelIcon } from "../../utils.js";

export class StoryThemeActorSheet extends LitmActorSheet {
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm-story-theme-actor-sheet"],
		position: { width: 400, height: "auto" },
		actions: {
			openThemeSheet: StoryThemeActorSheet.#onOpenThemeSheet,
		},
		window: {
			icon: "fa-solid fa-book-open",
			resizable: true,
		},
		dragDrop: [{ dragSelector: ".draggable", dropSelector: null }],
	};

	static PARTS = {
		body: {
			template: "systems/litmv2/templates/actor/story-theme.html",
			scrollable: [""],
		},
	};

	/**
	 * The single embedded story_theme item this actor wraps.
	 * @returns {Item|null}
	 */
	get storyTheme() {
		return this.document.items.find((i) => i.type === "story_theme") ?? null;
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const theme = this.storyTheme;
		if (!theme) return { ...context, theme: null, storyTags: [] };

		const enrichedDescription = await enrichHTML(
			theme.system.description,
			theme,
		);

		return {
			...context,
			theme: {
				_id: theme.id,
				name: theme.name,
				img: theme.img,
				hasCustomImage: theme.img !== CONFIG.litmv2.assets.icons.default,
				levelIcon: levelIcon(theme.system.level),
				levelLabel: game.i18n.localize(`LITM.Terms.${theme.system.level}`),
				themeTag: theme.system.themeTag,
				powerTags: theme.system.powerTags,
				weaknessTags: theme.system.weaknessTags,
				system: theme.system,
				enrichedDescription,
			},
			storyTags: this._prepareStoryTags(),
		};
	}

	/** @override */
	_renderModeToggle() {}

	/**
	 * Open the embedded story theme item sheet for editing.
	 * @private
	 */
	static #onOpenThemeSheet() {
		this.storyTheme?.sheet.render(true);
	}
}
