import { LitmActorSheet } from "../../sheets/base-actor-sheet.js";
import { LitmSettings } from "../../system/settings.js";
import { Sockets } from "../../system/sockets.js";
import { effectToPlain, enrichHTML, relationshipTagEffect, resolveEffect, transferBackpackTags } from "../../utils.js";
import { scratchTag } from "../../data/active-effects/scratchable-mixin.js";
import { resolveRollDialogOwnership } from "../../apps/roll-dialog.js";

/**
 * Extract and remove `newRelationship.<actorId>` keys from submit data,
 * returning an array of relationship tag effect creation data.
 */
function extractNewRelationships(submitData) {
	const effects = [];
	for (const key of Object.keys(submitData)) {
		if (!key.startsWith("newRelationship.")) continue;
		const name = submitData[key]?.trim();
		delete submitData[key];
		if (!name) continue;
		const targetId = key.slice("newRelationship.".length);
		effects.push(relationshipTagEffect({ name, targetId }));
	}
	return effects;
}

/**
 * Hero sheet for Legend in the Mist
 * Represents player characters with themes, tags, and progression
 */
export class HeroSheet extends LitmActorSheet {
	/** @override */
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm-hero-sheet"],
		tag: "form",
		actions: {
			openRollDialog: HeroSheet.#onOpenRollDialog,
			addStoryTag: LitmActorSheet._onAddStoryTag,
			addMomentOfFulfillment: HeroSheet.#onAddMomentOfFulfillment,
			removeMomentOfFulfillment: HeroSheet.#onRemoveMomentOfFulfillment,
			removeEffect: LitmActorSheet._onRemoveEffect,
			scratchTag: HeroSheet.#onScratchTag,
			selectTag: HeroSheet.#onSelectTag,
			toggleTagActive: HeroSheet.#onToggleTagActive,
			editItem: LitmActorSheet._onEditItem,
			removeItem: LitmActorSheet._onRemoveItem,
			viewActor: HeroSheet.#onViewActor,
			adjustProgress: LitmActorSheet._onAdjustProgress,
			openThemeAdvancement: HeroSheet.#onOpenThemeAdvancement,
			toggleTier: HeroSheet.#onToggleTier,
		},
		form: {
			handler: HeroSheet.#onSubmitForm,
			submitOnChange: true,
			closeOnSubmit: false,
		},
		window: {
			icon: "fa-solid fa-user-shield",
			resizable: true,
		},
		dragDrop: [{ dropSelector: null }],
	};

	/** @override */
	static PARTS = {
		header: { template: "systems/litmv2/templates/parts/header.html" },
		description: { template: "systems/litmv2/templates/parts/description.html" },
		content: { template: "systems/litmv2/templates/actor/hero-content.html" },
	};

	static PLAY_CONTENT_TEMPLATE = "systems/litmv2/templates/actor/hero-play-content.html";


	/** @override */
	async _onRender(context, options) {
		await super._onRender(context, options);
		for (const el of this.element.querySelectorAll(".litm--tag-item-status")) {
			el.addEventListener("contextmenu", HeroSheet.#onReduceStatus.bind(this));
		}
	}

	/**
	 * Roll dialog instance
	 * @type {LitmRollDialog}
	 * @private
	 */
	#rollDialog = null;

	/**
	 * Whether a roll dialog instance exists (without creating one)
	 * @type {boolean}
	 */
	get hasRollDialog() {
		return !!this.#rollDialog;
	}

	/**
	 * Get or create the roll dialog instance
	 * @returns {LitmRollDialog}
	 * @private
	 */
	get rollDialogInstance() {
		if (!this.#rollDialog) {
			this.#rollDialog = game.litmv2.LitmRollDialog.create({
				actorId: this.document.id,
			});
		}
		return this.#rollDialog;
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		const enriched = await this._enrichFields("description");

		const mofContext = await this.#prepareMoFContext();

		const themes = this.document.items
			.filter((i) => i.type === "theme" && !i.system.isFellowship)
			.sort((a, b) => a.sort - b.sort)
			.map((i) => this._prepareThemeData(i));

		const { hasFellowship, fellowship, fellowshipActor, storyThemes } =
			this.#prepareFellowshipContext();

		await this.#prepareSpecialImprovements(themes, fellowship);

		const backpackItem = this.document.system.backpackItem;
		const backpack = backpackItem
			? {
				name: backpackItem.name,
				id: backpackItem.id,
				tags: backpackItem.system.tags.filter(
					(e) => game.user.isGM || !e.system?.isHidden,
				),
			}
			: null;

		const tagEffects = this.system.backpack
			.filter((e) => game.user.isGM || !e.system?.isHidden);
		const statuses = this.system.statusEffects
			.filter((e) => game.user.isGM || !e.system?.isHidden);

		const relationshipEntries = hasFellowship ? this._prepareRelationshipEntries() : [];
		const relationshipVisible = relationshipEntries.filter((entry) =>
			entry.tag.trim(),
		);

		const { rollTags, scratchedTags } = this.#prepareRollContext();

		const fields = this.document.schema.getField("system");

		return {
			...context,
			system: this.system,
			namePlaceholder: game.i18n.localize("LITM.Ui.hero_name"),
			legendClass: "litm-banner theme-card__book",
			headerFields: [
				{
					id: `${this.document._id}-system-promise`,
					label: "LITM.Hero.promise",
					name: "system.promise",
					type: "number",
					value: this.document._source.system.promise,
					min: "0",
					max: "5",
					step: "1",
				},
			],
			enriched,
			fields,
			themes,
			hasFellowship,
			fellowship,
			fellowshipActorId: hasFellowship ? (fellowshipActor?.id ?? null) : null,
			storyThemes,
			backpack,
			storyTags: tagEffects,
			statuses,
			scratchedTags,
			relationshipEntries,
			relationshipVisible,
			...mofContext,
			rollTags,
			limit: this.system.limit,
		};
	}

	/**
	 * Prepare moments of fulfillment with enriched descriptions.
	 * @returns {Promise<object>}
	 */
	async #prepareMoFContext() {
		const momentsOfFulfillment = Array.isArray(this.system.mof)
			? this.system.mof
			: [];

		const momentOfFulfillmentEntries = await Promise.all(
			momentsOfFulfillment.map(async (moment) => {
				const description = moment.description ?? "";
				return {
					name: moment.name ?? "",
					description,
					enrichedDescription: await enrichHTML(description, this.document),
				};
			}),
		);
		const momentOfFulfillmentVisible = momentOfFulfillmentEntries.filter(
			(moment) =>
				(moment.name ?? "").trim() || (moment.description ?? "").trim(),
		);

		return { momentsOfFulfillment, momentOfFulfillmentEntries, momentOfFulfillmentVisible };
	}

	/**
	 * Prepare fellowship actor data, theme, and merged story themes.
	 * @returns {object}
	 */
	#prepareFellowshipContext() {
		const hasFellowship = LitmSettings.useFellowship;
		let fellowship = {};
		let fellowshipActor = null;

		if (hasFellowship) {
			fellowshipActor = this.system.fellowshipActor;
			if (fellowshipActor) {
				const fellowshipTheme = fellowshipActor.system.theme;
				fellowship = {
					actorId: fellowshipActor.id,
					actorName: fellowshipActor.name,
					hasTheme: !!fellowshipTheme,
				};
				if (fellowshipTheme) {
					const data = this._prepareThemeData(fellowshipTheme);
					fellowship = {
						...fellowship,
						name: fellowshipTheme.name,
						_id: fellowshipTheme.id,
						id: fellowshipTheme.id,
						img: fellowshipTheme.img,
						themeTag: data.themeTag,
						system: data.system,
					};
				}
			}
		}

		// Merge hero's own story themes + fellowship actor's story themes
		const ownStoryThemeItems = this.document.items
			.filter((i) => i.type === "story_theme")
			.sort((a, b) => a.sort - b.sort);
		const fellowshipStoryThemeItems = hasFellowship && fellowshipActor
			? fellowshipActor.items
					.filter((i) => i.type === "story_theme")
					.sort((a, b) => a.sort - b.sort)
			: [];

		const fellowshipStoryThemeIds = new Set(
			fellowshipStoryThemeItems.map((i) => i.id),
		);
		const storyThemes = [...ownStoryThemeItems, ...fellowshipStoryThemeItems]
			.map((i) => {
				const data = this._prepareThemeData(i);
				data.isFellowship = fellowshipStoryThemeIds.has(data._id);
				return data;
			});

		return { hasFellowship, fellowship, fellowshipActor, storyThemes };
	}

	/**
	 * Enrich special improvement descriptions and filter inactive ones in play mode.
	 * Mutates theme and fellowship objects in place.
	 * @param {object[]} themes
	 * @param {object} fellowship
	 */
	async #prepareSpecialImprovements(themes, fellowship) {
		const enrichImprovements = async (improvements = []) =>
			Promise.all(
				improvements.map(async (imp) => ({
					...imp,
					enrichedDescription: await enrichHTML(
						imp.description || "",
						this.document,
					),
				})),
			);

		for (const theme of themes) {
			theme.system.specialImprovements = await enrichImprovements(
				theme.system.specialImprovements,
			);
		}
		if (fellowship.hasTheme) {
			fellowship.system.specialImprovements = await enrichImprovements(
				fellowship.system.specialImprovements,
			);
		}

		if (!this._isEditMode) {
			for (const theme of themes) {
				theme.system.specialImprovements =
					theme.system.specialImprovements.filter((imp) => imp.isActive);
			}
			if (fellowship.hasTheme) {
				fellowship.system.specialImprovements =
					fellowship.system.specialImprovements.filter((imp) => imp.isActive);
			}
		}
	}

	/**
	 * Build roll tags and derive scratched subset from dialog state.
	 * @returns {object}
	 */
	#prepareRollContext() {
		const rollTags = this._buildAllRollTags();
		const scratchedTags = this.#rollDialog
			? rollTags.filter((t) => {
					const sel = this.#rollDialog.getSelection(t.id);
					return t.system?.isScratched || sel.state === "scratched";
				})
			: [];
		return { rollTags, scratchedTags };
	}

	/* -------------------------------------------- */
	/*  Event Handlers & Actions                    */
	/* -------------------------------------------- */

	/**
	 * Open the roll dialog
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @static
	 * @protected
	 */
	static async #onSubmitForm(event, form, formData) {
		const submitData = formData.object;
		const newEffects = extractNewRelationships(submitData);
		const toDelete = HeroSheet.#cleanupEmptyRelationships(this.document, submitData);

		await LitmActorSheet._onSubmitActorForm.call(this, event, form, formData);
		if (newEffects.length) {
			await this.document.createEmbeddedDocuments("ActiveEffect", newEffects);
		}
		if (toDelete.length) {
			await this.document.deleteEmbeddedDocuments("ActiveEffect", toDelete);
		}
	}

	static #onOpenRollDialog(_event, _target) {
		this.renderRollDialog();
	}

	/**
	 * Find relationship effects with empty names and mark them for deletion.
	 * @param {Actor} actor - The hero actor document
	 * @param {object} submitData - The form submission data (mutated)
	 * @returns {string[]} Array of effect IDs to delete
	 */
	static #cleanupEmptyRelationships(actor, submitData) {
		const toDelete = [];
		const relationshipIds = new Set(actor.system.relationships.map((e) => e.id));
		for (const key of Object.keys(submitData)) {
			const match = key.match(/^effects\.(.+)\.name$/);
			if (!match) continue;
			const id = match[1];
			if (!relationshipIds.has(id)) continue;
			if (!submitData[key]?.trim()) {
				toDelete.push(id);
				delete submitData[key];
			}
		}
		return toDelete;
	}

	_prepareRelationshipEntries() {
		const heroActors = (game.actors ?? []).filter(
			(a) => a.type === "hero" && a.id !== this.document.id,
		);
		const existing = this.system.relationships;
		return heroActors
			.map((actor) => {
				const effect = existing.find((e) => e.system.targetId === actor.id);
				return {
					actorId: actor.id,
					name: actor.name,
					img: actor.img,
					tag: effect?.name ?? "",
					isScratched: effect?.system?.isScratched ?? false,
					effectId: effect?.id ?? null,
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	_buildAllRollTags() {
		return this.system.allRollTags.map(effectToPlain);
	}

	/**
	 * Add a moment of fulfillment entry
	 * @private
	 */
	static async #onAddMomentOfFulfillment() {
		const moments = foundry.utils.deepClone(this.system.mof ?? []);
		moments.push({ name: "", description: "" });
		await this.document.update({ "system.mof": moments });
	}

	/**
	 * Remove a moment of fulfillment entry
	 * @param {Event} _event        The triggering event
	 * @param {HTMLElement} target  The target element
	 * @private
	 */
	static async #onRemoveMomentOfFulfillment(_event, target) {
		const index = Number(target.dataset.index);
		if (!Number.isFinite(index)) return;
		const moments = foundry.utils.deepClone(this.system.mof ?? []);
		moments.splice(index, 1);
		await this.document.update({ "system.mof": moments });
	}

	/**
	 * Select/deselect a tag for rolling
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onSelectTag(event, target) {
		// Prevent double clicks
		if (event.detail > 1) return;
		if (!this.document.isOwner) return;

		const actionTarget = target.closest?.("[data-tag-id]") ?? target;
		const tagId = actionTarget.dataset.tagId || actionTarget.dataset.id;
		if (!tagId) return;

		const tagFromSystem = this._buildAllRollTags().find((e) => e.id === tagId);
		const tagKey = tagFromSystem?.uuid ?? tagId;
		const sel = this.rollDialogInstance.getSelection(tagKey);
		const isWeaknessTag = (tagFromSystem?.type ?? actionTarget.dataset.tagType) === "weakness_tag";
		const isScratched = tagFromSystem?.system?.isScratched ?? false;
		const selected = !!sel.state;

		// Scratch/unscratch tag without rolling (alt-click)
		if (event.altKey) {
			if (!tagFromSystem?.system?.toggleScratch) return;
			const effect = resolveEffect(tagFromSystem.id, this.document, { fellowship: true });
			if (!effect) return;
			await scratchTag(this.document, effect);
			return;
		}

		// Can't select scratched tags, except weakness tags
		if (!selected && isScratched && !isWeaknessTag) return;

		// Add or remove the tag from the roll
		if (selected) {
			this.rollDialogInstance.setCharacterTagState(tagKey, "");
		} else {
			const states = (tagFromSystem?.system?.allowedStates ?? ",positive").split(",");
			const nextState = event.shiftKey ? states[states.length - 1] : states[1];
			this.rollDialogInstance.setCharacterTagState(tagKey, nextState);
		}

		// Open the roll dialog if not already open, otherwise re-render it
		if (!this.rollDialogInstance.rendered) {
			this.renderRollDialog();
		} else {
			this.rollDialogInstance.render();
		}
		this.render();
	}

	/**
	 * Toggle scratch state of a play-mode tag
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onScratchTag(_event, target) {
		const effectId = target.closest("[data-effect-id]")?.dataset.effectId ?? target.dataset.tagId;
		if (!effectId) return;
		const effect = resolveEffect(effectId, this.document, { fellowship: true });
		if (!effect) return;
		await scratchTag(this.document, effect);
	}

	/**
	 * Toggle the active state of a power, weakness, or backpack tag in edit mode.
	 * Handles backpack story_tag effects locally, delegates the rest to super.
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onToggleTagActive(event, target) {
		const actionTarget = target.closest?.("[data-tag-id]") ?? target;
		if (actionTarget.dataset.tagType === "backpack") {
			return this._toggleEffect(event, target, (e) => e.type === "story_tag");
		}
		return LitmActorSheet._onToggleTagActive.call(this, event, target);
	}

	/**
	 * View an actor sheet
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static #onViewActor(_event, target) {
		const actorId = target.dataset.actorId;
		if (!actorId) return;
		const actor = game.actors.get(actorId);
		actor?.sheet.render(true);
	}

	/**
	 * Open theme advancement modal for a theme
	 * @param {Event} event        The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onToggleTier(_event, target) {
		const effectId = target.closest("[data-effect-id]")?.dataset.effectId;
		const tier = Number.parseInt(target.dataset.tier, 10);
		if (!effectId || !Number.isFinite(tier)) return;

		const effect = resolveEffect(effectId, this.document);
		if (!effect || effect.type !== "status_tag") return;

		const newTiers = [...effect.system.tiers];
		newTiers[tier - 1] = !newTiers[tier - 1];
		await effect.update({ "system.tiers": newTiers });
	}

	static async #onReduceStatus(event) {
		const statusRow = event.target.closest("[data-effect-id]");
		if (!statusRow) return;
		event.preventDefault();

		const effect = resolveEffect(statusRow.dataset.effectId, this.document);
		if (!effect || effect.type !== "status_tag") return;
		if (!effect.system.tiers.some(Boolean)) return;

		const newTiers = effect.system.calculateReduction(1);
		await effect.update({ "system.tiers": newTiers });
	}

	static #onOpenThemeAdvancement(_event, target) {
		const item = this.resolveItem(target);
		if (!item) return;

		const fellowshipEl = target.closest("[data-fellowship-actor-id]");
		const actorId =
			fellowshipEl?.dataset?.fellowshipActorId ?? this.document.id;

		new game.litmv2.ThemeAdvancementApp({
			actorId,
			themeId: item.id,
		}).render(true);
	}

	/**
	 * Resolve an item from the hero or a linked fellowship actor
	 * @param {HTMLElement} element An element inside the item container
	 * @returns {Item|null}
	 * @private
	 */
	/** @override */
	resolveItem(element) {
		const itemEl =
			element.closest("[data-item-id]") ?? element.closest(".item");
		const itemId = itemEl?.dataset?.itemId ?? itemEl?.dataset?.id;
		if (!itemId) return null;

		const fellowshipEl = element.closest("[data-fellowship-actor-id]");
		if (fellowshipEl) {
			const actor = game.actors.get(fellowshipEl.dataset.fellowshipActorId);
			return actor?.items.get(itemId) ?? null;
		}

		return this.document.items.get(itemId) ?? null;
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
			theme: () => {
				if (item.system.isFellowship) {
					return ui.notifications.warn(game.i18n.localize("LITM.Ui.warn_fellowship_use_actor"));
				}
				const numThemes = this.document.items.filter(
					(i) => i.type === "theme" && !i.system.isFellowship,
				).length;
				if (numThemes >= 4) {
					return ui.notifications.warn(game.i18n.localize("LITM.Ui.warn_theme_limit"));
				}
				return this.document.createEmbeddedDocuments("Item", [item.toObject()]);
			},
			story_theme: () => this.document.createEmbeddedDocuments("Item", [item.toObject()]),
			backpack: () => {
				const numBackpacks = this.document.items.filter((i) => i.type === "backpack").length;
				if (numBackpacks >= 1) return this.#handleLootDrop(item);
				return this.document.createEmbeddedDocuments("Item", [item.toObject()]);
			},
		};

		const handler = handlers[item.type];
		if (handler) return handler();
		return super._onDropItem(event, item);
	}

	/**
	 * Handle dropping a backpack when one already exists (loot transfer)
	 * @param {Item} item The backpack item being dropped
	 * @private
	 */
	async #handleLootDrop(item) {
		const tags = item.system.tags;
		const content = await foundry.applications.handlebars.renderTemplate(
			"systems/litmv2/templates/apps/loot-dialog.html",
			{
				contents: tags,
				cssClass: "litm--loot-dialog",
			},
		);
		const chosenLoot = await foundry.applications.api.DialogV2.prompt({
			window: { title: game.i18n.localize("LITM.Ui.item_transfer_title") },
			content,
			ok: {
				icon: "fas fa-check",
				label: game.i18n.localize("LITM.Terms.transfer"),
				callback: (_event, button) => {
					return Array.from(
						button.form.querySelectorAll("input[type=checkbox]:checked"),
					).map((el) => el.value);
				},
			},
		});

		if (!chosenLoot?.length) return;

		const backpack = this.document.system.backpackItem;

		if (!backpack) {
			ui.notifications.error(game.i18n.localize("LITM.Ui.error_no_backpack"));
			return;
		}

		const transferredNames = item.effects
			.filter((e) => chosenLoot.includes(e.id))
			.map((e) => e.name);

		await transferBackpackTags(item, backpack, chosenLoot);

		ui.notifications.info(
			game.i18n.format("LITM.Ui.item_transfer_success", {
				items: transferredNames.join(", "),
			}),
		);

		backpack.sheet.render(true);
	}

	/* -------------------------------------------- */
	/*  Helper Methods                              */
	/* -------------------------------------------- */

	/**
	 * Update the roll dialog with new data
	 * @param {object} data Data to update
	 */
	updateRollDialog(data) {
		this.#rollDialog?.receiveUpdate(data);
	}

	/**
	 * Select a tag for the roll dialog from an external source (e.g., fellowship sheet).
	 * @param {string} tagType - The tag type (e.g., "power_tag", "weakness_tag")
	 * @param {string} tagId - The tag effect ID
	 * @param {string} tagName - The tag name (fallback for lookup)
	 * @param {{ shiftKey?: boolean }} [options] - Modifier key state
	 */
	selectTagForRoll(_tagType, tagId, tagName, { shiftKey = false } = {}) {
		const allTags = this._buildAllRollTags();
		let tagRef =
			(tagId && allTags.find((t) => t.id === tagId)) ||
			(tagName && allTags.find((t) => t.name === tagName));
		if (!tagRef) return;

		const tagKey = tagRef.uuid ?? tagRef.id;
		const isWeaknessTag = tagRef.type === "weakness_tag";
		const isScratched = tagRef.system?.isScratched ?? false;
		const sel = this.rollDialogInstance.getSelection(tagKey);
		const selected = !!sel.state;

		if (!selected && isScratched && !isWeaknessTag) return;

		if (selected) {
			this.rollDialogInstance.setCharacterTagState(tagKey, "");
		} else {
			const nextState = isWeaknessTag ? "negative" : (shiftKey ? "negative" : "positive");
			this.rollDialogInstance.setCharacterTagState(tagKey, nextState);
		}

		if (!this.rollDialogInstance.rendered) {
			this.renderRollDialog();
		} else {
			this.rollDialogInstance.render();
		}
		this.render();
	}

	/**
	 * Render the roll dialog
	 * @param {object} options Render options
	 */
	renderRollDialog(options = {}) {
		const { isOwner, activeOwnerId } = resolveRollDialogOwnership(this.document, game.user.id);

		if (options.toggle && this.rollDialogInstance.rendered) {
			this.rollDialogInstance.close();
			return;
		}

		if (isOwner) {
			this.rollDialogInstance.ownerId = game.user.id;
			const shouldBroadcast = activeOwnerId !== game.user.id;
			if (shouldBroadcast) this.rollDialogInstance.updatePresence(true);
		} else {
			this.rollDialogInstance.ownerId = activeOwnerId;
			Sockets.dispatch("requestRollDialogSync", {
				actorId: this.document.id,
			});
		}

		this.rollDialogInstance.render(true);
	}

	/**
	 * Reset the roll dialog
	 */
	resetRollDialog() {
		this.rollDialogInstance.reset();
		this.render();
	}
}
