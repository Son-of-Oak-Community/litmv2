import { LitmActorSheet } from "../../sheets/base-actor-sheet.js";
import { enrichHTML, queryItemsFromPacks, toPlainObject } from "../../utils.js";

const TRACK_ICONS = {
	promise: "fa-sun",
	improve: "fa-arrow-trend-up",
	milestone: "fa-mountain-sun",
	abandon: "fa-wind",
};
const TRACK_LABEL_KEYS = {
	promise: "LITM.Ui.track_complete_promise",
	improve: "LITM.Ui.track_complete_improve",
	milestone: "LITM.Ui.track_complete_milestone",
	abandon: "LITM.Ui.track_complete_abandon",
};

function buildTrackCompleteContent({ text, type, actorId, themeId }) {
	const icon = TRACK_ICONS[type];
	const label = game.i18n.localize(TRACK_LABEL_KEYS[type]);
	const footer =
		type === "improve" && actorId && themeId
			? `<footer class="litm-track-complete__footer">
				<button type="button" data-click="open-theme-advancement"
				        data-actor-id="${actorId}" data-theme-id="${themeId}">
					<i class="fas fa-wand-magic-sparkles"></i> ${game.i18n.localize("LITM.Ui.choose_improvement")}
				</button>
			</footer>`
			: "";
	return `<div class="litmv2 litm-track-complete litm-track-complete--${type}">
		<header class="litm-track-complete__header">
			<i class="fas ${icon}"></i>
			<span>${label}</span>
		</header>
		<p class="litm-track-complete__body"><strong>${text}</strong></p>
		${footer}
	</div>`;
}

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
			toggleEffectVisibility: LitmActorSheet._onToggleEffectVisibility,
			toggleTagActive: FellowshipSheet.#onToggleTagActive,
			selectTag: FellowshipSheet.#onSelectTag,
			adjustProgress: FellowshipSheet.#onAdjustProgress,
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
			isGM: game.user.isGM,
			isOwner: this.document.isOwner,
			isEditMode: this._isEditMode,
			enriched: {
				description: enrichedDescription,
			},
			theme,
			storyThemes,
			storyTags: this._prepareStoryTags(),
			tagTypeOptions: {
				tag: "LITM.Terms.tag",
				status: "LITM.Terms.status",
			},
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
				.filter((u) => u.character?.type === "hero")
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
				}));

			const weaknesses = themes
				.flatMap((theme) => theme.system.weakness)
				.filter((tag) => tag.isActive && !tag.isScratched)
				.map((tag) => tag.name);

			const storyTags = hero.system.storyTags;
			const statuses = hero.system.statuses.filter((s) => s.value > 0);

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
				storyTags,
				statuses,
				hasTagsOrStatuses: storyTags.length > 0 || statuses.length > 0,
			};
		});
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

		if (tagType === "themeTag") {
			await item.update({ "system.isScratched": !item.system.isScratched });
			return;
		}

		const tagArrayKey =
			tagType === "weaknessTag" ? "weaknessTags" : "powerTags";
		const systemPath =
			item.type === "story_theme"
				? `system.theme.${tagArrayKey}`
				: `system.${tagArrayKey}`;

		const findTag = (t) => (tagId && t.id === tagId) || t.name === tagName;
		const tags = (item.system[tagArrayKey] ?? []).map((t) => toPlainObject(t));
		const tag = tags.find(findTag);
		if (!tag) return;

		if (scratch) tag.isScratched = !tag.isScratched;
		else tag.isActive = !tag.isActive;
		await item.update({ [systemPath]: tags });
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
			if (tagType === "weaknessTag") return;
			return FellowshipSheet.#scratchTag.call(this, tagType, tagId, tagName);
		}

		// Regular click: add to user's hero roll dialog
		const hero = game.user.character;
		if (!hero || hero.type !== "hero") return;
		const heroSheet = hero.sheet;
		if (!heroSheet) return;

		const dialog = heroSheet.rollDialogInstance;

		// Sync all known tags into the roll dialog
		const existingById = new Map(dialog.characterTags.map((t) => [t.id, t]));
		for (const tag of heroSheet._buildAllRollTags()) {
			if (!existingById.has(tag.id)) {
				dialog.characterTags.push(tag);
			}
		}

		// Find the tag by id, then by name fallback
		let tagRef =
			(tagId && dialog.characterTags.find((t) => t.id === tagId)) ||
			(tagName &&
				dialog.characterTags.find(
					(t) => t.displayName === tagName || t.name === tagName,
				));
		if (!tagRef) {
			tagRef = FellowshipSheet.#buildTagData.call(
				this,
				tagType,
				tagId,
				tagName,
			);
			if (tagRef) dialog.characterTags.push(tagRef);
		}
		if (!tagRef) return;

		const resolvedId = tagRef.id;
		const isWeaknessTag = tagRef.type === "weaknessTag";
		const isScratched = tagRef.isScratched ?? false;
		const selected = !!tagRef.state;

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
		if (tagType === "themeTag") {
			const theme = this.document.items.get(tagId);
			if (!theme) return null;
			return {
				id: tagId,
				name: theme.name,
				displayName: theme.name,
				themeId: theme.id,
				themeName: theme.name,
				type: "themeTag",
				isSingleUse: true,
				fromFellowship: true,
				state: "",
				states: ",positive",
			};
		}

		const tagArrayKey =
			tagType === "weaknessTag" ? "weaknessTags" : "powerTags";
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
					tagType === "weaknessTag"
						? ",negative,positive"
						: ",positive,negative",
			};
		}
		return null;
	}

	/**
	 * Toggle scratch state of a tag on this fellowship actor.
	 * @param {string} tagType   The tag type (powerTag, themeTag)
	 * @param {string} tagId     The tag ID (may be empty for legacy data)
	 * @param {string} [tagName] Tag name fallback for legacy data without persisted IDs
	 * @private
	 */
	static async #scratchTag(tagType, tagId, tagName) {
		if (tagType === "themeTag") {
			const theme = this.document.items.get(tagId);
			if (!theme) return;
			await theme.update({ "system.isScratched": !theme.system.isScratched });
			return;
		}

		const tagArrayKey =
			tagType === "weaknessTag" ? "weaknessTags" : "powerTags";
		const match = (t) =>
			(tagId && t.id === tagId) || (tagName && t.name === tagName);

		const parentItem = this.document.items.find(
			(i) =>
				["theme", "story_theme"].includes(i.type) &&
				i.system[tagArrayKey]?.some(match),
		);
		if (!parentItem) return;

		const isStoryTheme = parentItem.type === "story_theme";
		const raw = parentItem.system.toObject();
		const tags = isStoryTheme ? raw.theme[tagArrayKey] : raw[tagArrayKey];
		const systemPath = isStoryTheme
			? `system.theme.${tagArrayKey}`
			: `system.${tagArrayKey}`;
		const tag = tags.find(match);
		if (!tag || !tag.isActive) return;

		tag.isScratched = !tag.isScratched;
		await parentItem.update({ [systemPath]: tags });
	}

	/**
	 * Adjust a progress track
	 * @private
	 */
	static async #onAdjustProgress(_event, target) {
		const button = target.closest("button") ?? target;
		const boxIndex = parseInt(button.dataset.index, 10);
		if (Number.isNaN(boxIndex)) return;

		const container = button.closest(
			".progress-display, .progress-buttons, .progress-boxes",
		);
		if (!container) return;
		const attrib = container.dataset.id;
		if (!attrib) return;

		const itemElement = button.closest(".item");
		const item = itemElement
			? this.document.items.get(itemElement.dataset.id)
			: null;

		const doc = item || this.document;
		const currentValue = foundry.utils.getProperty(doc, attrib);
		const newValue = boxIndex < currentValue ? boxIndex : boxIndex + 1;

		const updateData = {};
		foundry.utils.setProperty(updateData, attrib, newValue);
		await doc.update(updateData);

		// Celebrate when a track reaches its maximum
		const trackInfo = FellowshipSheet.#detectTrackCompletion(
			attrib,
			newValue,
			doc,
			this.document,
		);
		if (trackInfo) {
			await foundry.documents.ChatMessage.create({
				content: buildTrackCompleteContent(trackInfo),
				speaker: foundry.documents.ChatMessage.getSpeaker({
					actor: this.document,
				}),
			});
		}
	}

	/**
	 * Detect whether a track update is a completion event and return a
	 * typed info object, or null if not a completion.
	 * @private
	 */
	static #detectTrackCompletion(attrib, newValue, doc, actor) {
		const isTheme = doc !== actor;
		const isFellowship = isTheme && (doc.system?.isFellowship ?? false);

		if (!isTheme) return null;

		const themeLabel = isFellowship
			? game.i18n.format("LITM.Ui.fellowship_theme_label", { theme: doc.name })
			: doc.name;

		// Improve (max 3)
		if (attrib === "system.improve.value" && newValue === 3) {
			return {
				text: game.i18n.format("LITM.Ui.improve_complete", {
					actor: actor.name,
					theme: themeLabel,
				}),
				type: "improve",
				actorId: doc.parent?.id ?? actor.id,
				themeId: doc.id,
			};
		}

		// Milestone / Abandon (max 3)
		if (newValue === 3) {
			const isMilestone = attrib.includes("milestone");
			const isAbandon = attrib.includes("abandon");
			if (isMilestone || isAbandon) {
				const trackKey = isMilestone
					? "LITM.Themes.milestone"
					: "LITM.Themes.abandon";
				return {
					text: game.i18n.format("LITM.Ui.theme_track_complete", {
						actor: actor.name,
						theme: themeLabel,
						track: game.i18n.localize(trackKey),
					}),
					type: isMilestone ? "milestone" : "abandon",
				};
			}
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
	 * Open a dialog to browse and pick a fellowship themebook or themekit
	 * @private
	 */
	static async #onBrowseThemes() {
		// Check if a fellowship theme already exists
		const numThemes = this.document.items.filter(
			(i) => i.type === "theme",
		).length;
		if (numThemes >= 1) {
			return ui.notifications.warn(
				game.i18n.localize("LITM.Ui.warn_fellowship_limit"),
			);
		}

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
			const img = `systems/litmv2/assets/media/icons/${level}.svg`;
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

			const numThemes = this.document.items.filter(
				(i) => i.type === "theme",
			).length;
			if (numThemes >= 1) {
				return ui.notifications.warn(
					game.i18n.localize("LITM.Ui.warn_fellowship_limit"),
				);
			}

			const validLevels = Object.keys(CONFIG.litmv2.theme_levels);
			const level = validLevels.includes(item.system.theme_level)
				? item.system.theme_level
				: validLevels[0];
			const img = `systems/litmv2/assets/media/icons/${level}.svg`;
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

			const numThemes = this.document.items.filter(
				(i) => i.type === "theme",
			).length;
			if (numThemes >= 1) {
				return ui.notifications.warn(
					game.i18n.localize("LITM.Ui.warn_fellowship_limit"),
				);
			}

			return this.document.createEmbeddedDocuments("Item", [item.toObject()]);
		}

		// Story themes: allow unlimited
		if (item.type === "story_theme") {
			return this.document.createEmbeddedDocuments("Item", [item.toObject()]);
		}
	}
}
