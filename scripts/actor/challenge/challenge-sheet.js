import { LitmActorSheet } from "../../sheets/base-actor-sheet.js";
import { TagStringSyncMixin } from "../../sheets/tag-string-sync-mixin.js";
import { syncAddonEffects } from "../../system/hooks/item-hooks.js";
import { confirmDelete, enrichHTML } from "../../utils.js";

/**
 * Challenge sheet for Legend in the Mist
 * Represents NPCs, obstacles, and challenges for heroes to overcome
 */
export class ChallengeSheet extends TagStringSyncMixin(LitmActorSheet) {
	_expandedAddons = new Set();

	/** @override */
	static DEFAULT_OPTIONS = {
		classes: ["litm", "litm-challenge-sheet"],
		tag: "form",
		actions: {
			addLimit: ChallengeSheet.#onAddLimit,
			removeLimit: ChallengeSheet.#onRemoveLimit,
			increaseLimit: ChallengeSheet.#onIncreaseLimit,
			decreaseLimit: ChallengeSheet.#onDecreaseLimit,
			addVignette: LitmActorSheet._onAddVignette,
			removeVignette: LitmActorSheet._onRemoveVignette,
			editVignette: LitmActorSheet._onEditVignette,
			adjustRating: ChallengeSheet.#onAdjustRating,
			addMight: ChallengeSheet.#onAddMight,
			removeMight: ChallengeSheet.#onRemoveMight,
			editAddon: ChallengeSheet.#onEditAddon,
			removeAddon: ChallengeSheet.#onRemoveAddon,
			toggleAddonDetail: ChallengeSheet.#onToggleAddonDetail,
		},
		form: {
			handler: ChallengeSheet.#onSubmitChallengeForm,
			submitOnChange: true,
			closeOnSubmit: false,
		},
		window: {
			icon: "fa-solid fa-dragon",
			resizable: true,
			controls: [],
		},
		dragDrop: [{ dropSelector: null }],
	};

	/** @override */
	static PARTS = {
		form: {
			template: "systems/litmv2/templates/actor/challenge.html",
			scrollable: [""],
		},
	};

	/** @override */
	static _getEditModeTemplate() {
		return "systems/litmv2/templates/actor/challenge.html";
	}

	/** @override */
	static _getPlayModeTemplate() {
		return "systems/litmv2/templates/actor/challenge-play.html";
	}

	/* -------------------------------------------- */
	/*  Rendering                                   */
	/* -------------------------------------------- */

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		const sys = this.system;

		// Enrich HTML fields for display
		const enrichedSpecialFeatures = await enrichHTML(
			sys.specialFeatures,
			this.document,
		);
		const enrichedDescription = await enrichHTML(
			sys.description,
			this.document,
		);

		// Use derived fields in play mode, base fields in edit mode
		const isPlay = !this._isEditMode;

		// Enrich the tags string for display
		const enrichedTags = await enrichHTML(
			isPlay ? (sys.derivedTags || sys.tags || "") : (sys.tags || ""),
			this.document,
		);

		// Prepare vignette items
		const { vignettes, vignettesByType } = await this._prepareVignettes();

		// Prepare addon threats with enriched HTML
		const addonThreats = await Promise.all(
			(sys.addonThreats || []).map(async (t) => ({
				...t,
				threat: await enrichHTML(t.threat, this.document),
				consequences: await Promise.all(
					t.consequences.map((c) => enrichHTML(c, this.document)),
				),
			})),
		);

		// Combined display vignettes: own vignettes + addon threats
		const displayVignettes = [
			...vignettes,
			...addonThreats.map((t) => ({
				_id: null,
				name: t.name,
				system: {
					threat: t.threat,
					consequences: t.consequences,
					isConsequenceOnly: t.isConsequenceOnly,
				},
			})),
		];

		return {
			...context,
			isOwner: this.document.isOwner,
			isEditMode: this._isEditMode,
			enriched: {
				description: enrichedDescription,
				specialFeatures: enrichedSpecialFeatures,
				tags: enrichedTags,
			},
			tagsString: sys.tags || "",
			vignettes,
			vignettesByType,
			displayVignettes,
			challenges: sys.challenges,
			limits: await Promise.all(
				(isPlay ? (sys.derivedLimits || sys.limits) : sys.limits || []).map(
					async (limit) => {
						const hasGroupedStatuses = this.document.effects.some(
							(e) => e.type === "status_tag" && e.system?.limitId === limit.id,
						);
						const isFromAddon = isPlay &&
							!sys.limits.some((l) => l.id === limit.id);
						return {
							...limit,
							isImpossible: limit.max === 0,
							isAutoManaged: hasGroupedStatuses || isFromAddon,
							enrichedOutcome: await enrichHTML(limit.outcome, this.document),
						};
					},
				),
			),
			rating: isPlay ? (sys.derivedRating ?? sys.rating) : sys.rating,
			might: await Promise.all(
				(isPlay ? (sys.derivedMight || sys.might) : sys.might || []).map(async (
					entry,
				) => ({
					...entry,
					enrichedDescription: await enrichHTML(
						entry.description,
						this.document,
					),
				})),
			),
			mightOptions: {
				adventure: "LITM.Terms.adventure",
				greatness: "LITM.Terms.greatness",
			},
			// Addon data for edit mode
			addons: await Promise.all((sys.activeAddons || []).map(async (a) => {
				const item = this.document.items.get(a.id);
				const expanded = this._expandedAddons.has(a.id);
				return {
					...a,
					categorySummary: item?.system.categories.join(", ") || "",
					stars: Array(a.ratingBonus || 0).fill(true),
					expanded,
					enrichedDescription: expanded
						? await enrichHTML(item?.system.description, this.document)
						: "",
					enrichedTags: expanded
						? await enrichHTML(item?.system.tags, this.document)
						: "",
					enrichedSpecialFeatures: expanded
						? await enrichHTML(item?.system.specialFeatures, this.document)
						: "",
				};
			})),
			// Derived categories for play mode display
			derivedCategories: sys.derivedCategories || [],
		};
	}

	/* -------------------------------------------- */
	/*  Event Handlers & Actions                    */
	/* -------------------------------------------- */

	static async #onSubmitChallengeForm(_event, _form, formData) {
		const submitData = formData.object;

		await this._updateEmbeddedFromForm(submitData);

		// Notify story tags of effect changes
		this._notifyStoryTags();

		// Normalize might entries if they exist
		const might = foundry.utils.getProperty(submitData, "system.might");
		if (Array.isArray(might)) {
			submitData["system.might"] = might.map((entry) => ({
				level: entry.level || "adventure",
				description: entry.description || "",
			}));
		}

		await this.document.update(submitData);
	}

	static async #onAddLimit(_event, _target) {
		const limits = [
			...this.system.limits,
			{
				id: foundry.utils.randomID(),
				label: game.i18n.localize("LITM.Ui.new_limit"),
				outcome: "",
				max: 3,
				value: 0,
			},
		];
		await this.document.update({ "system.limits": limits });
	}

	static async #onRemoveLimit(_event, target) {
		if (!(await confirmDelete("LITM.Terms.limit"))) return;

		const index = Number(target.dataset.index);
		const limits = this.system.limits.filter((_, i) => i !== index);
		await this.document.update({ "system.limits": limits });
	}

	static async #onIncreaseLimit(_event, target) {
		const index = Number(target.dataset.index);
		const limit = this.system.limits[index];
		if (!limit || limit.max === 0) return;

		const limits = [...this.system.limits];
		limits[index] = {
			...limit,
			value: Math.min(limit.value + 1, limit.max),
		};
		await this.document.update({ "system.limits": limits });
	}

	static async #onDecreaseLimit(_event, target) {
		const index = Number(target.dataset.index);
		const limit = this.system.limits[index];
		if (!limit || limit.max === 0) return;

		const limits = [...this.system.limits];
		limits[index] = { ...limit, value: Math.max(limit.value - 1, 0) };
		await this.document.update({ "system.limits": limits });
	}

	static async #onAdjustRating(event, target) {
		event.preventDefault();
		event.stopPropagation();

		const button = target.closest("button");
		if (!button) return;

		const boxIndex = parseInt(button.dataset.index, 10);
		if (Number.isNaN(boxIndex)) return;

		const current = this.system.rating;
		const candidate = current === boxIndex + 1 ? boxIndex : boxIndex + 1;
		const next = Math.max(1, Math.min(5, candidate));
		await this.document.update({ "system.rating": next });
	}

	static async #onAddMight(_event, _target) {
		const might = [
			...(this.system.might || []),
			{ level: "adventure", description: "" },
		];
		await this.document.update({ "system.might": might });
	}

	static async #onRemoveMight(_event, target) {
		const index = Number(target.dataset.index);
		const might = (this.system.might || []).filter((_, i) => i !== index);
		await this.document.update({ "system.might": might });
	}

	static #onToggleAddonDetail(_event, target) {
		const itemId = target.dataset.itemId;
		if (this._expandedAddons.has(itemId)) {
			this._expandedAddons.delete(itemId);
		} else {
			this._expandedAddons.add(itemId);
		}
		this.render();
	}

	static #onEditAddon(_event, target) {
		const itemId = target.dataset.itemId;
		const item = this.document.items.get(itemId);
		item?.sheet.render(true);
	}

	static async #onRemoveAddon(_event, target) {
		if (!(await confirmDelete("TYPES.Item.addon"))) return;

		const itemId = target.dataset.itemId;

		// Delete ActiveEffects contributed by this addon
		const addonEffects = this.document.effects
			.filter((e) => e.getFlag("litmv2", "addonId") === itemId)
			.map((e) => e.id);
		if (addonEffects.length) {
			await this.document.deleteEmbeddedDocuments("ActiveEffect", addonEffects);
		}

		// Delete the addon item
		await this.document.deleteEmbeddedDocuments("Item", [itemId]);
		this._notifyStoryTags();
	}

	/* -------------------------------------------- */
	/*  Drag & Drop                                 */
	/* -------------------------------------------- */

	/** @override */
	async _onDropItem(event, item) {
		if (item.type === "vignette") return super._onDropItem(event, item);
		if (item.type === "addon") return this._onDropAddon(event, item);
	}

	/**
	 * Handle dropping an addon item onto the challenge sheet.
	 * Clones the addon as an embedded item and stores the source UUID.
	 * @param {DragEvent} event  The drop event
	 * @param {Item} item        The dropped addon item
	 * @returns {Promise<void>}
	 * @protected
	 */
	async _onDropAddon(_event, item) {
		const addonData = item.toObject();
		addonData.system.sourceId = item.uuid;
		const [created] = await this.document.createEmbeddedDocuments("Item", [
			addonData,
		]);

		if (created?.system.tags) {
			await syncAddonEffects(this.document, created);
			this._notifyStoryTags();
		}
	}
}
