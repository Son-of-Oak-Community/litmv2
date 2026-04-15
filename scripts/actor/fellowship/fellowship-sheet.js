import { LitmActorSheet } from "../../sheets/base-actor-sheet.js";
import { ACTOR_TYPES, getThemeLevels, getDefaultThemeLevel } from "../../system/config.js";
import { effectToPlain, findApplicableEffect, levelIcon, queryItemsFromPacks, resolveEffect } from "../../utils.js";
import { scratchTag } from "../../data/active-effects/scratchable-mixin.js";

/**
 * Fellowship sheet for Legend in the Mist
 * Represents a shared fellowship actor with a fellowship theme, story themes, and story tags
 */
export class FellowshipSheet extends LitmActorSheet {
	/** @override */
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm-fellowship-sheet"],
		tag: "form",
		actions: {
			editItem: LitmActorSheet._onEditItem,
			removeItem: LitmActorSheet._onRemoveItem,
			addStoryTheme: FellowshipSheet.#onAddStoryTheme,
			addStoryTag: LitmActorSheet._onAddStoryTag,
			removeEffect: LitmActorSheet._onRemoveEffect,
			toggleEffectVisibility: FellowshipSheet.#onToggleEffectVisibility,
			toggleTagActive: FellowshipSheet.#onToggleTagActive,
			selectTag: FellowshipSheet.#onSelectTag,
			adjustProgress: LitmActorSheet._onAdjustProgress,
			openThemeAdvancement: FellowshipSheet.#onOpenThemeAdvancement,
			browseThemes: FellowshipSheet.#onBrowseThemes,
			"open-hero-sheet": FellowshipSheet.#onOpenHeroSheet,
			scratchTag: FellowshipSheet.#onScratchTag,
		},
		form: {
			handler: LitmActorSheet._onSubmitActorForm,
			submitOnChange: true,
			closeOnSubmit: false,
		},
		window: {
			icon: "fa-solid fa-campground",
			resizable: true,
		},
		dragDrop: [{ dropSelector: null }],
	};

	/** @override */
	static PARTS = {
		header: { template: "systems/litmv2/templates/parts/header.html" },
		description: { template: "systems/litmv2/templates/parts/description.html" },
		content: { template: "systems/litmv2/templates/actor/fellowship-content.html" },
	};

	static PLAY_CONTENT_TEMPLATE = "systems/litmv2/templates/actor/fellowship-play-content.html";

	/**
	 * Build a flat list of all roll-dialog-compatible tags for this fellowship.
	 * Used by the GM viewer in LitmRollDialog to populate the fellowship tab.
	 * @returns {object[]}
	 */
	_buildAllRollTags() {
		return this.system.allRollTags.map(effectToPlain);
	}

	/* -------------------------------------------- */
	/*  Rendering                                   */
	/* -------------------------------------------- */

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		const enriched = await this._enrichFields("description");

		// Prepare fellowship theme (single theme item with isFellowship)
		const themeItem = this.document.items.find(
			(i) => i.type === "theme" && i.system.isFellowship,
		);
		const theme = themeItem ? this._prepareThemeData(themeItem) : null;

		// Prepare story themes
		const storyThemes = this.document.items
			.filter((i) => i.type === "story_theme")
			.sort((a, b) => a.sort - b.sort)
			.map((i) => this._prepareThemeData(i));

		// Party overview data (GM only)
		const party = game.user.isGM ? this.#buildPartyOverview() : [];

		return {
			...context,
			namePlaceholder: game.i18n.localize("LITM.Ui.fellowship_name"),
			enriched,
			theme,
			storyThemes,
			storyTags: this._prepareStoryTags(),
			party,
		};
	}

	/**
	 * Strip HTML from hero descriptions (presentation concern) and filter to active players.
	 * Aggregation logic lives in FellowshipData#partyOverview.
	 * @returns {object[]}
	 */
	#buildPartyOverview() {
		const activePlayerCharacterIds = new Set(
			game.users
				.filter((u) => u.active && u.character?.type === ACTOR_TYPES.hero)
				.map((u) => u.character.id),
		);
		return this.system.partyOverview
			.filter((hero) => activePlayerCharacterIds.has(hero.id))
			.map((hero) => ({
				...hero,
				description: (hero.description ?? "").replace(/<[^>]*>/g, "").trim(),
			}));
	}

	/* -------------------------------------------- */
	/*  Event Handlers & Actions                    */
	/* -------------------------------------------- */

	/**
	 * Toggle the hidden state of a story tag / status card effect.
	 * @param {Event} _event
	 * @param {HTMLElement} target
	 * @private
	 */
	static async #onToggleEffectVisibility(_event, target) {
		const effectId = target.dataset.id;
		const effect = resolveEffect(effectId, this.document);
		if (!effect) return;
		await effect.update({ "system.isHidden": !effect.system.isHidden });
		this._notifyStoryTags();
	}

	/**
	 * Open a hero's sheet from the party overview
	 * @private
	 */
	static #onOpenHeroSheet(_event, target) {
		const actor = game.actors.get(target.dataset.actorId);
		actor?.sheet?.render(true);
	}

	/**
	 * Add a new story theme
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onAddStoryTheme(_event, _target) {
		const [storyTheme] = await this.document.createEmbeddedDocuments("Item", [
			{
				name: game.i18n.localize("LITM.Ui.new_story_theme"),
				type: "story_theme",
			},
		]);
		storyTheme.sheet.render(true);
	}

	/**
	 * Toggle the active state of a tag in edit mode.
	 * Handles fellowship_tag items locally (scratch on item itself),
	 * delegates theme tags to the shared handler.
	 * @private
	 */
	static async #onToggleTagActive(event, target) {
		const actionTarget = target.closest?.("[data-tag-id]") ?? target;
		const tagType = actionTarget.dataset.tagType;

		if (tagType === "fellowship_tag") {
			const itemEl = target.closest("[data-item-id]") ?? target.closest(".item");
			const itemId = itemEl?.dataset?.itemId ?? itemEl?.dataset?.id;
			if (!itemId) return;
			const item = this.document.items.get(itemId);
			if (!item) return;
			await item.update({ "system.isScratched": !item.system.isScratched });
			return;
		}

		return LitmActorSheet._onToggleTagActive.call(this, event, target);
	}

	/**
	 * Scratch a tag by effect ID (Alt+Click from play mode).
	 * @param {Event} _event
	 * @param {HTMLElement} target
	 * @private
	 */
	static async #onScratchTag(_event, target) {
		const effectId = target.closest("[data-effect-id]")?.dataset.effectId;
		if (!effectId) return;
		const effect = findApplicableEffect(this.document, (e) => e.id === effectId);
		if (effect) await scratchTag(this.document, effect);
	}

	/**
	 * Select a tag for rolling or scratch it with Alt+Click.
	 * Click delegates to the user's hero roll dialog.
	 * Alt+Click scratches the tag (except weakness tags).
	 * @private
	 */
	static async #onSelectTag(event, target) {
		if (this._isEditMode) return;

		const tagType = target.dataset.tagType;
		const tagId = target.dataset.tagId;
		const tagName = target.dataset.text;
		if (!tagType || (!tagId && !tagName)) return;

		// Alt+Click: scratch (except weakness tags)
		if (event.altKey) {
			if (tagType === "weakness_tag") return;
			const effect = findApplicableEffect(this.document, (e) => e.id === tagId);
			if (effect) await scratchTag(this.document, effect);
			return;
		}

		// Regular click: add to user's hero roll dialog
		const hero = game.user.character;
		if (!hero || hero.type !== "hero") return;

		hero.sheet?.selectTagForRoll?.(tagType, tagId, tagName, { shiftKey: event.shiftKey });
	}

	/**
	 * Open theme advancement modal
	 * @private
	 */
	static #onOpenThemeAdvancement(_event, target) {
		const itemId = target.dataset.itemId;
		const item = this.document.items.get(itemId);
		if (!item) return;

		new game.litmv2.ThemeAdvancementApp({
			actorId: this.document.id,
			themeId: itemId,
		}).render(true);
	}

	/**
	 * Check whether the fellowship already has the maximum number of themes (1).
	 * If so, show a warning notification.
	 * @returns {boolean} true if the limit has been reached
	 */
	#hasReachedThemeLimit() {
		const numThemes = this.document.items.filter(
			(i) => i.type === "theme",
		).length;
		if (numThemes >= 1) {
			ui.notifications.warn(
				game.i18n.localize("LITM.Ui.warn_fellowship_limit"),
			);
			return true;
		}
		return false;
	}

	/**
	 * Open a dialog to browse and pick a fellowship themebook or themekit
	 * @private
	 */
	static async #onBrowseThemes() {
		if (this.#hasReachedThemeLimit()) return;

		// Gather fellowship themebooks and themekits from all Item compendiums and world items
		const fellowshipMapper = (entry, { pack }) => {
			const uuid = pack
				? entry.uuid || `Compendium.${pack.collection}.${entry._id}`
				: entry.uuid;
			const img = entry.img || "icons/svg/book.svg";
			return { uuid, name: entry.name, img };
		};
		const isFellowship = (entry) => !!entry.system?.isFellowship;

		const themebooks = await queryItemsFromPacks({
			type: "themebook",
			category: "themebooks",
			filter: isFellowship,
			indexFields: [
				"img",
				"system.theme_level",
				"system.level",
				"system.isFellowship",
			],
			map: fellowshipMapper,
		});
		const themekits = await queryItemsFromPacks({
			type: "theme",
			category: "themekits",
			filter: isFellowship,
			indexFields: [
				"img",
				"system.theme_level",
				"system.level",
				"system.isFellowship",
			],
			map: fellowshipMapper,
		});

		themebooks.sort((a, b) => a.name.localeCompare(b.name));
		themekits.sort((a, b) => a.name.localeCompare(b.name));

		// Mark the first themekit as default-checked only when no themebooks exist
		if (!themebooks.length && themekits.length) {
			themekits[0].firstKit = true;
		}

		const content = await foundry.applications.handlebars.renderTemplate(
			"systems/litmv2/templates/apps/fellowship-theme-picker.html",
			{
				themebooks,
				themekits,
				hasAny: themebooks.length || themekits.length,
			},
		);

		const result = await foundry.applications.api.DialogV2.prompt({
			window: {
				title: game.i18n.localize("LITM.Ui.fellowship_browse_title"),
			},
			content,
			ok: {
				icon: "fas fa-check",
				label: game.i18n.localize("LITM.Terms.select"),
				callback: (_event, button) => {
					const checked = button.form.querySelector(
						"input[name=choice]:checked",
					);
					if (!checked) return null;
					return { uuid: checked.value, type: checked.dataset.type };
				},
			},
		});

		if (!result) return;

		const doc = await foundry.utils.fromUuid(result.uuid);
		if (!doc) return;

		if (result.type === "themebook") {
			await this.#createThemeFromThemebook(doc);
		} else {
			await this.document.createEmbeddedDocuments("Item", [doc.toObject()]);
		}
	}

	/**
	 * Create a fellowship theme item from a themebook document.
	 * Shared by #onBrowseThemes and _onDropItem.
	 * @param {Item} doc  The source themebook document
	 */
	async #createThemeFromThemebook(doc) {
		const validLevels = getThemeLevels();
		const level = validLevels.includes(doc.system.theme_level)
			? doc.system.theme_level
			: getDefaultThemeLevel();
		const img = levelIcon(level);
		const [theme] = await this.document.createEmbeddedDocuments("Item", [
			{
				name: doc.name,
				type: "theme",
				img,
				system: {
					themebook: doc.name,
					level,
					isFellowship: true,
				},
			},
		]);
		theme.sheet.render(true);
	}

	/* -------------------------------------------- */
	/*  Drag & Drop                                 */
	/* -------------------------------------------- */

	/** @override */
	async _onDropItem(event, item) {
		if (this.actor.uuid === item.parent?.uuid) {
			return this._onSortItem(event, item);
		}

		const handlers = {
			themebook: async () => {
				if (!item.system.isFellowship) {
					return ui.notifications.warn(game.i18n.localize("LITM.Ui.warn_fellowship_not_fellowship"));
				}
				if (this.#hasReachedThemeLimit()) return;
				return this.#createThemeFromThemebook(item);
			},
			theme: () => {
				if (!item.system.isFellowship) {
					return ui.notifications.warn(game.i18n.localize("LITM.Ui.warn_fellowship_not_fellowship"));
				}
				if (this.#hasReachedThemeLimit()) return;
				return this.document.createEmbeddedDocuments("Item", [item.toObject()]);
			},
			story_theme: () => this.document.createEmbeddedDocuments("Item", [item.toObject()]),
		};

		const handler = handlers[item.type];
		if (handler) return handler();
	}

}
