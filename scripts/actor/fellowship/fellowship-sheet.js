import { LitmActorSheet } from "../../sheets/base-actor-sheet.js";
import { THEME_TAG_TYPES } from "../../system/config.js";
import { enrichHTML, levelIcon, queryItemsFromPacks } from "../../utils.js";

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
		form: {
			template: "systems/litmv2/templates/actor/fellowship.html",
			scrollable: [""],
		},
	};

	/** @override */
	static _getEditModeTemplate() {
		return "systems/litmv2/templates/actor/fellowship.html";
	}

	/** @override */
	static _getPlayModeTemplate() {
		return "systems/litmv2/templates/actor/fellowship-play.html";
	}

	/* -------------------------------------------- */
	/*  Rendering                                   */
	/* -------------------------------------------- */

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		const enrichedDescription = await enrichHTML(
			this.system.description,
			this.document,
		);

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
		const party = game.user.isGM ? this.#preparePartyOverview() : [];

		return {
			...context,
			isOwner: this.document.isOwner,
			isEditMode: this._isEditMode,
			enriched: {
				description: enrichedDescription,
			},
			theme,
			storyThemes,
			storyTags: this._prepareStoryTags(),
			party,
		};
	}

	/* -------------------------------------------- */
	/*  Event Handlers & Actions                    */
	/* -------------------------------------------- */

	/**
	 * Prepare party overview data for all hero actors.
	 * @returns {object[]}
	 */
	#preparePartyOverview() {
		const fellowshipId = this.document.id;
		const playerCharacterIds = new Set(
			game.users
				.filter((u) => u.active && u.character?.type === "hero")
				.map((u) => u.character.id),
		);
		const heroes = game.actors.filter(
			(a) =>
				a.type === "hero" &&
				playerCharacterIds.has(a.id) &&
				a.system.fellowshipId === fellowshipId,
		);
		return heroes.map((hero) => {
			const themes = hero.items.filter(
				(i) =>
					i.type === "theme" && !i.system.isFellowship && !i.system.isScratched,
			);

			const quests = themes
				.filter((theme) => theme.system.quest?.description)
				.map((theme) => ({
					themeName: theme.name,
					description: theme.system.quest.description,
					milestone: theme.system.quest.tracks.milestone.value,
					abandon: theme.system.quest.tracks.abandon.value,
				}));

			const weaknesses = themes
				.flatMap((theme) => theme.system.weaknessTags)
				.filter((tag) => tag.active && !tag.system.isScratched)
				.map((tag) => tag.name);

			const relationshipTags = hero.system.relationships
				.filter((e) => e.name && !e.system?.isScratched);
			const storyTags = hero.system.backpack
				.filter((e) => e.active && (game.user.isGM || !e.system?.isHidden));
			const statuses = hero.system.statuses
				.filter((e) => e.active && (e.system?.currentTier ?? 0) > 0);

			// Strip HTML from description
			const desc = hero.system.description ?? "";
			const div = document.createElement("div");
			div.innerHTML = desc;
			const description = div.textContent?.trim() ?? "";

			return {
				id: hero.id,
				name: hero.name,
				img: hero.img,
				description,
				quests,
				weaknesses,
				relationshipTags,
				storyTags,
				statuses,
				hasTagsOrStatuses: storyTags.length > 0 || statuses.length > 0,
			};
		});
	}

	/**
	 * Toggle the hidden state of a story tag / status card effect.
	 * @param {Event} _event
	 * @param {HTMLElement} target
	 * @private
	 */
	static async #onToggleEffectVisibility(_event, target) {
		const effectId = target.dataset.id;
		const effect = this.document.effects.get(effectId);
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
	 * Click = Scratch/Unscratch, Shift+Click = Activate/Deactivate.
	 * @private
	 */
	static async #onToggleTagActive(event, target) {
		const actionTarget = target.closest?.("[data-tag-id]") ?? target;
		const tagId = actionTarget.dataset.tagId || actionTarget.dataset.id;
		const tagName = actionTarget.dataset.text;
		const tagType = actionTarget.dataset.tagType;
		if (!tagId && !tagName) return;

		const scratch = !event.shiftKey;

		const itemEl = target.closest("[data-item-id]") ?? target.closest(".item");
		const itemId = itemEl?.dataset?.itemId ?? itemEl?.dataset?.id;
		if (!itemId) return;

		const item = this.document.items.get(itemId);
		if (!item) return;

		if (tagType === "fellowship_tag") {
			await item.update({ "system.isScratched": !item.system.isScratched });
			return;
		}

		const effect = item.effects.get(tagId)
			?? [...item.effects].find((e) => e.name === tagName && THEME_TAG_TYPES.has(e.type));
		if (!effect) return;

		if (scratch) {
			await item.updateEmbeddedDocuments("ActiveEffect", [
				{ _id: effect.id, "system.isScratched": !effect.system.isScratched },
			]);
		} else {
			await item.updateEmbeddedDocuments("ActiveEffect", [
				{ _id: effect.id, disabled: !effect.disabled },
			]);
		}
	}

	/**
	 * Select a tag for rolling or scratch it with Alt+Click.
	 * Click delegates to the user's hero roll dialog.
	 * Alt+Click scratches the tag (except weakness tags).
	 * @private
	 */
	static #onSelectTag(event, target) {
		if (this._isEditMode) return;

		const tagType = target.dataset.tagType;
		const tagId = target.dataset.tagId;
		const tagName = target.dataset.text;
		if (!tagType || (!tagId && !tagName)) return;

		// Alt+Click: scratch (except weakness tags)
		if (event.altKey) {
			if (tagType === "weakness_tag") return;
			return this.system.scratchTag(tagType, tagId, tagName);
		}

		// Regular click: add to user's hero roll dialog
		const hero = game.user.character;
		if (!hero || hero.type !== "hero") return;
		const heroSheet = hero.sheet;
		if (!heroSheet) return;

		const dialog = heroSheet.rollDialogInstance;

		// Find the tag by id, then by name fallback
		const allTags = heroSheet._buildAllRollTags();
		let tagRef =
			(tagId && allTags.find((t) => t.id === tagId)) ||
			(tagName && allTags.find((t) => t.name === tagName));
		if (!tagRef) {
			tagRef = FellowshipSheet.#buildTagData.call(this, tagType, tagId, tagName);
		}
		if (!tagRef) return;

		const resolvedId = tagRef.id;
		const isWeaknessTag = tagRef.type === "weakness_tag";
		const isScratched = tagRef.system?.isScratched ?? false;
		const sel = dialog.getSelection(resolvedId);
		const selected = !!sel.state;

		if (!selected && isScratched && !isWeaknessTag) return;

		if (selected) {
			dialog.setCharacterTagState(resolvedId, "");
		} else {
			const nextState = isWeaknessTag ? "negative" : "positive";
			dialog.setCharacterTagState(resolvedId, nextState);
		}

		if (!dialog.rendered) {
			heroSheet.renderRollDialog();
		} else {
			dialog.render();
		}
		heroSheet.render();
	}

	/**
	 * Build a roll-dialog-compatible tag object directly from this actor's items.
	 * Used as a fallback when the hero sheet's _buildAllRollTags() doesn't include the tag.
	 * Falls back to name matching when id is empty (legacy data without persisted tag IDs).
	 * @param {string} tagType
	 * @param {string} tagId
	 * @param {string} [tagName]
	 * @returns {object|null}
	 * @private
	 */
	static #buildTagData(tagType, tagId, tagName) {
		if (tagType === "fellowship_tag") {
			const theme = this.document.items.get(tagId);
			if (!theme) return null;
			return {
				id: tagId,
				name: theme.name,
				displayName: theme.name,
				themeId: theme.id,
				themeName: theme.name,
				type: "fellowship_tag",
				isSingleUse: true,
				fromFellowship: true,
				state: "",
				states: ",positive",
			};
		}

		const tagArrayKey =
			tagType === "weakness_tag" ? "weaknessTags" : "powerTags";
		const match = (t) =>
			(tagId && t.id === tagId) || (tagName && t.name === tagName);
		for (const item of this.document.items) {
			if (!["theme", "story_theme"].includes(item.type)) continue;
			const tag = (item.system[tagArrayKey] ?? []).find(match);
			if (!tag) continue;
			// Use the stored id if present, otherwise generate a stable key from name
			const id = tag.id || `${item.id}-${tag.name}`;
			return {
				id,
				name: `${item.name} - ${tag.name}`,
				displayName: tag.name,
				themeId: item.id,
				themeName: item.name,
				type: tag.type ?? tagType,
				isSingleUse: true,
				fromFellowship: true,
				state: "",
				states:
					tagType === "weakness_tag"
						? ",negative,positive"
						: ",positive,negative",
			};
		}
		return null;
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
			const validLevels = Object.keys(CONFIG.litmv2.theme_levels);
			const level = validLevels.includes(doc.system.theme_level)
				? doc.system.theme_level
				: validLevels[0];
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
		} else {
			await this.document.createEmbeddedDocuments("Item", [doc.toObject()]);
		}
	}

	/* -------------------------------------------- */
	/*  Drag & Drop                                 */
	/* -------------------------------------------- */

	/** @override */
	async _onDropItem(event, item) {
		if (!["theme", "story_theme", "themebook"].includes(item.type)) return;

		// Handle sorting if the item is already on this actor
		if (this.actor.uuid === item.parent?.uuid) {
			return this._onSortItem(event, item);
		}

		// Themebook drop: create a new theme from the themebook
		if (item.type === "themebook") {
			if (!item.system.isFellowship) {
				return ui.notifications.warn(
					game.i18n.localize("LITM.Ui.warn_fellowship_not_fellowship"),
				);
			}

			if (this.#hasReachedThemeLimit()) return;

			const validLevels = Object.keys(CONFIG.litmv2.theme_levels);
			const level = validLevels.includes(item.system.theme_level)
				? item.system.theme_level
				: validLevels[0];
			const img = levelIcon(level);
			const [theme] = await this.document.createEmbeddedDocuments("Item", [
				{
					name: item.name,
					type: "theme",
					img,
					system: {
						themebook: item.name,
						level,
						isFellowship: true,
					},
				},
			]);
			theme.sheet.render(true);
			return;
		}

		// Fellowship theme: only allow themes with isFellowship flag, limit 1
		if (item.type === "theme") {
			if (!item.system.isFellowship) {
				return ui.notifications.warn(
					game.i18n.localize("LITM.Ui.warn_fellowship_not_fellowship"),
				);
			}

			if (this.#hasReachedThemeLimit()) return;

			return this.document.createEmbeddedDocuments("Item", [item.toObject()]);
		}

		// Story themes: allow unlimited
		if (item.type === "story_theme") {
			return this.document.createEmbeddedDocuments("Item", [item.toObject()]);
		}
	}

	/** @override */
	async _onDropActor(_event, actor) {
		if (actor.type !== "story_theme") return;
		const theme = actor.items.find((i) => i.type === "story_theme");
		if (!theme) return;
		return this.document.createEmbeddedDocuments("Item", [theme.toObject()]);
	}
}
