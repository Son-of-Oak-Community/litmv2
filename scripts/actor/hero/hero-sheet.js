import { LitmActorSheet } from "../../sheets/base-actor-sheet.js";
import { THEME_TAG_TYPES } from "../../system/config.js";
import { LitmSettings } from "../../system/settings.js";
import { Sockets } from "../../system/sockets.js";
import { effectToPlain, enrichHTML, relationshipTagEffect } from "../../utils.js";

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
		form: {
			template: "systems/litmv2/templates/actor/hero.html",
			scrollable: [""],
		},
	};

	/** @override */
	static _getEditModeTemplate() {
		return "systems/litmv2/templates/actor/hero.html";
	}

	/** @override */
	static _getPlayModeTemplate() {
		return "systems/litmv2/templates/actor/hero-play.html";
	}

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

		// Enrich HTML description
		const enrichedDescription = await enrichHTML(
			this.system.description,
			this.document,
		);

		const momentsOfFulfillment = Array.isArray(this.system.mof)
			? this.system.mof
			: [];

		const momentOfFulfillmentEntries = await Promise.all(
			momentsOfFulfillment.map(async (moment) => {
				const description = moment.description ?? "";
				const enrichedDescription = await enrichHTML(
					description,
					this.document,
				);
				return {
					name: moment.name ?? "",
					description,
					enrichedDescription,
				};
			}),
		);
		const momentOfFulfillmentVisible = momentOfFulfillmentEntries.filter(
			(moment) =>
				(moment.name ?? "").trim() || (moment.description ?? "").trim(),
		);

		// Prepare regular themes (exclude fellowship themes owned by hero)
		const allThemes = this.document.items
			.filter((i) => i.type === "theme" && !i.system.isFellowship)
			.sort((a, b) => a.sort - b.sort);

		const themes = [];

		for (const i of allThemes) {
			themes.push(this._prepareThemeData(i));
		}

		// Prepare fellowship from linked fellowship actor
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

		// Prepare story themes (hero's own + fellowship actor's)
		const ownStoryThemeItems = this.document.items
			.filter((i) => i.type === "story_theme")
			.sort((a, b) => a.sort - b.sort);
		const fellowshipStoryThemeItems = hasFellowship && fellowshipActor
			? fellowshipActor.items
					.filter((i) => i.type === "story_theme")
					.sort((a, b) => a.sort - b.sort)
			: [];
		const allStoryThemeItems = [
			...ownStoryThemeItems,
			...fellowshipStoryThemeItems,
		];

		const fellowshipStoryThemeIds = new Set(
			fellowshipStoryThemeItems.map((i) => i.id),
		);
		const storyThemes = allStoryThemeItems.map((i) => {
			const data = this._prepareThemeData(i);
			data.isFellowship = fellowshipStoryThemeIds.has(data._id);
			return data;
		});

		// Enrich special improvements descriptions for all themes and fellowship
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

		// In play mode, only show active special improvements
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

		// Prepare backpack
		const backpackItem = this.document.system.backpackItem;
		const backpack = backpackItem
			? {
					name: backpackItem.name,
					id: backpackItem.id,
					tags: [...backpackItem.system.tags],
				}
			: null;

		// Get story tags and statuses
		const tagEffects = this.system.backpack
			.filter((e) => game.user.isGM || !e.system?.isHidden);
		const statuses = this.system.statuses
			.filter((e) => game.user.isGM || !e.system?.isHidden);

		const relationshipEntries = hasFellowship ? this._prepareRelationshipEntries() : [];
		const relationshipVisible = relationshipEntries.filter((entry) =>
			entry.tag.trim(),
		);

		// Build roll tags once and derive scratched subset
		const rollTags = this._buildAllRollTags();
		const scratchedTags = this.#rollDialog
			? rollTags.filter((t) => {
					const sel = this.#rollDialog.getSelection(t.id);
					return t.system?.isScratched || sel.state === "scratched";
				})
			: [];

		// Prepare enriched fields for the editor helper
		const fields = this.document.schema.getField("system");

		return {
			...context,
			system: this.system,
			isOwner: this.document.isOwner,
			isEditMode: this._isEditMode,
			enriched: {
				description: enrichedDescription,
			},
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
			momentsOfFulfillment,
			momentOfFulfillmentEntries,
			momentOfFulfillmentVisible,

			rollTags,
			limit: this.system.limit,
		};
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

		// Relationship effects cleared to empty → delete instead of update
		const toDelete = [];
		const relationshipIds = new Set(
			this.system.relationships.map((e) => e.id),
		);
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

	_prepareRelationshipEntries() {
		return this.system.relationshipEntries;
	}

	_buildAllRollTags() {
		const sys = this.system;
		const tags = [
			...sys.themes.flatMap((g) => g.tags),
			...sys.backpack,
			...sys.statuses,
		];
		if (LitmSettings.useFellowship) {
			tags.push(
				...sys.fellowship.themes.flatMap((g) => g.tags),
				...sys.fellowship.tags,
				...sys.relationships.filter((e) => e.name),
			);
		}
		return tags.map(effectToPlain);
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
	static #onSelectTag(event, target) {
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
			return this.toggleScratchTag(tagFromSystem);
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
	static #onScratchTag(event, target) {
		if (this._isEditMode) return;

		event.preventDefault();
		event.stopPropagation();

		const tagType = target.dataset.tagType;
		const tagId = target.dataset.tagId;
		if (!tagType || !tagId) return;

		switch (tagType) {
			case "power_tag":
			case "fellowship_tag": {
				const parentTheme = this.document.items.find(
					(i) =>
						["theme", "story_theme"].includes(i.type) &&
						i.effects.has(tagId),
				) ?? game.litmv2?.fellowship?.items.find(
					(i) =>
						["theme", "story_theme"].includes(i.type) &&
						i.effects.has(tagId),
				);
				if (!parentTheme) return;

				const effect = parentTheme.effects.get(tagId);
				if (!effect || effect.disabled) return;

				return this.toggleScratchTag({
					id: effect.id,
					type: tagType,
				});
			}
			case "backpack": {
				const backpack = this.document.system.backpackItem;
				if (!backpack) return;
				const effect = backpack.effects.get(tagId);
				if (!effect || effect.disabled) return;
				return this.toggleScratchTag({
					id: effect.id,
					type: "backpack",
					isScratched: effect.system.isScratched ?? false,
				});
			}
			default:
				return;
		}
	}

	/**
	 * Toggle the active state of a power or weakness tag in edit mode
	 * @param {Event} _event       The triggering event
	 * @param {HTMLElement} target The target element
	 * @private
	 */
	static async #onToggleTagActive(event, target) {
		const actionTarget = target.closest?.("[data-tag-id]") ?? target;
		const tagId = actionTarget.dataset.tagId || actionTarget.dataset.id;
		const tagName = actionTarget.dataset.text;
		const tagType = actionTarget.dataset.tagType;
		if (!tagId && !tagName) return;

		const scratch = !event.shiftKey;

		const item = this.resolveItem(target);
		if (!item) return;

		if (tagType === "backpack") {
			const effect = item.effects.get(tagId)
				?? [...item.effects].find((e) => e.name === tagName && e.type === "story_tag");
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
			return;
		}

		// Theme tag effects — find and update the effect directly
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
	 * Toggle scratch state of a tag
	 * @param {object} tag The tag to toggle
	 * @private
	 */
	async toggleScratchTag(tag) {
		return this.system.toggleScratchTag(tag);
	}

	async gainImprovement(tag) {
		return this.system.gainImprovement(tag);
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

		const effect = [...this.document.allApplicableEffects()].find((e) => e.id === effectId);
		if (!effect || effect.type !== "status_tag") return;

		const newTiers = [...effect.system.tiers];
		newTiers[tier - 1] = !newTiers[tier - 1];
		await effect.update({ "system.tiers": newTiers });
	}

	static async #onReduceStatus(event) {
		const statusRow = event.target.closest("[data-effect-id]");
		if (!statusRow) return;
		event.preventDefault();

		const effect = [...this.document.allApplicableEffects()].find((e) => e.id === statusRow.dataset.effectId);
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
		if (!["backpack", "theme", "story_theme"].includes(item.type)) {
			return super._onDropItem(event, item);
		}

		// Check if already owned (for sorting)
		if (this.actor.uuid === item.parent?.uuid) {
			return this._onSortItem(event, item);
		}

		const itemData = item.toObject();

		// Fellowship themes cannot be dropped onto heroes — use fellowship actors
		if (item.type === "theme" && item.system.isFellowship) {
			return ui.notifications.warn(
				game.i18n.localize("LITM.Ui.warn_fellowship_use_actor"),
			);
		}

		// Check theme limit (max 4)
		if (item.type === "theme") {
			const numThemes = this.document.items.filter(
				(i) => i.type === "theme" && !i.system.isFellowship,
			).length;
			if (numThemes >= 4) {
				return ui.notifications.warn(
					game.i18n.localize("LITM.Ui.warn_theme_limit"),
				);
			}
			return this.document.createEmbeddedDocuments("Item", [itemData]);
		}

		// Story themes have no limit - add directly
		if (item.type === "story_theme") {
			return this.document.createEmbeddedDocuments("Item", [itemData]);
		}

		// Check backpack limit (max 1)
		if (item.type === "backpack") {
			const numBackpacks = this.document.items.filter(
				(i) => i.type === "backpack",
			).length;
			if (numBackpacks >= 1) {
				return this.#handleLootDrop(item);
			}
			return this.document.createEmbeddedDocuments("Item", [itemData]);
		}
	}

	/** @override */
	async _onDropActor(_event, actor) {
		if (actor.type !== "story_theme") return;
		const theme = actor.items.find((i) => i.type === "story_theme");
		if (!theme) return;
		return this.document.createEmbeddedDocuments("Item", [theme.toObject()]);
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

		// Transfer chosen effects from source backpack to target
		const sourceEffects = item.effects.filter(
			(e) => e.type === "story_tag" && chosenLoot.includes(e.id),
		);
		const effectData = sourceEffects.map((e) => ({
			name: e.name,
			type: "story_tag",
			transfer: true,
			disabled: e.disabled,
			system: e.system.toObject(),
		}));
		await backpack.createEmbeddedDocuments("ActiveEffect", effectData);
		await item.deleteEmbeddedDocuments(
			"ActiveEffect",
			sourceEffects.map((e) => e.id),
		);

		ui.notifications.info(
			game.i18n.format("LITM.Ui.item_transfer_success", {
				items: sourceEffects.map((e) => e.name).join(", "),
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
	 * Render the roll dialog
	 * @param {object} options Render options
	 */
	renderRollDialog(options = {}) {
		const activeOwnerId =
			this.document.getFlag("litmv2", "rollDialogOwner")?.ownerId || null;
		const activeOwner = activeOwnerId ? game.users.get(activeOwnerId) : null;
		const hasActorPermission =
			game.user.isGM || this.document.testUserPermission(game.user, "OWNER");
		// GM should only be a viewer when a player is actively using the dialog
		const hasPlayerOwner = game.users.some(
			(u) => !u.isGM && this.document.testUserPermission(u, "OWNER"),
		);
		const gmAsViewer = game.user.isGM && hasPlayerOwner
			&& !!activeOwnerId && !activeOwner?.isGM && !!activeOwner?.active;
		const canClaimOwnership =
			!gmAsViewer &&
			(activeOwnerId === game.user.id ||
				(!activeOwnerId && hasActorPermission) ||
				(!activeOwner?.active && hasActorPermission) ||
				(activeOwner?.isGM && hasActorPermission));
		const isOwner = canClaimOwnership;

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
