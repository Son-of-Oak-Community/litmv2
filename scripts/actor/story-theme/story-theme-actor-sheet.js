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

	get storyTheme() {
		return this.document.system.storyTheme;
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

	/** @override */
	async _onDropItem(event, item) {
		if (item.type !== "story_theme") return super._onDropItem(event, item);

		if (this.document.uuid === item.parent?.uuid) {
			return this._onSortItem(event, item);
		}

		const existing = this.storyTheme;
		if (existing) {
			const shouldReplace = await foundry.applications.api.DialogV2.confirm({
				window: {
					title: game.i18n.localize("LITM.Ui.replace_story_theme_title"),
				},
				content: game.i18n.localize("LITM.Ui.replace_story_theme_content"),
				no: { default: true },
				classes: ["litm"],
			});
			if (!shouldReplace) return;
			await existing.delete();
		}

		await this.document.createEmbeddedDocuments("Item", [item.toObject()]);
		await this.document.update({ name: item.name, img: item.img });
	}

	/**
	 * Open the embedded story theme item sheet for editing.
	 * @private
	 */
	static #onOpenThemeSheet() {
		this.storyTheme?.sheet.render(true);
	}
}
