import { LitmActorSheet } from "../../sheets/base-actor-sheet.js";
import { TagStringSyncMixin } from "../../sheets/tag-string-sync-mixin.js";
import { syncAddonEffects } from "../../system/hooks/item-hooks.js";
import { confirmDelete, enrichHTML, removeAtIndex } from "../../utils.js";
import { MIGHT_OPTIONS } from "../../system/config.js";
import { ChallengeData } from "./challenge-data.js";

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
		header: { template: "systems/litmv2/templates/parts/header.html" },
		description: { template: "systems/litmv2/templates/parts/description.html" },
		content: { template: "systems/litmv2/templates/actor/challenge-content.html" },
	};

	static PLAY_CONTENT_TEMPLATE = "systems/litmv2/templates/actor/challenge-play-content.html";

	/* -------------------------------------------- */
	/*  Rendering                                   */
	/* -------------------------------------------- */

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);

		const sys = this.system;
		const isPlay = !this._isEditMode;

		const enriched = await this._enrichFields("description", "specialFeatures");
		const enrichedTags = await enrichHTML(
			isPlay ? (sys.derivedTags || sys.tags || "") : (sys.tags || ""),
			this.document,
		);
		enriched.tags = enrichedTags;

		const { vignettes, vignettesByType } = await this._prepareVignettes();
		const { addons } = await this.#prepareAddonContext();
		const { limits, might } = await this.#prepareLimitsAndMight(isPlay);

		const displayVignettes = this.document.system.allDisplayThreats;

		return {
			...context,
			headerFields: [
				{
					id: "category",
					label: "LITM.Terms.category",
					name: "system.category",
					type: "text",
					value: this.document._source.system.category,
				},
				{
					id: "rating",
					label: "LITM.Terms.rating",
					name: "system.rating",
					type: "number",
					value: isPlay
						? (sys.derivedRating ?? this.document._source.system.rating)
						: this.document._source.system.rating,
					min: "0",
					max: "5",
					step: "1",
				},
			],
			enriched,
			tagsString: sys.tags || "",
			vignettes,
			vignettesByType,
			displayVignettes,
			challenges: sys.challenges,
			limits,
			rating: isPlay ? (sys.derivedRating ?? sys.rating) : sys.rating,
			might,
			mightOptions: MIGHT_OPTIONS,
			addons,
			derivedCategories: sys.derivedCategories || [],
		};
	}

	/**
	 * Prepare addon threats (enriched HTML) and addon data for edit mode.
	 * @returns {Promise<{addonThreats: object[], addons: object[]}>}
	 */
	async #prepareAddonContext() {
		const sys = this.system;
		const addonThreats = await Promise.all(
			(sys.addonThreats || []).map(async (t) => ({
				...t,
				threat: await enrichHTML(t.threat, this.document),
				consequences: await Promise.all(
					t.consequences.map((c) => enrichHTML(c, this.document)),
				),
			})),
		);

		const addons = await Promise.all((sys.activeAddons || []).map(async (a) => {
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
		}));

		return { addonThreats, addons };
	}

	/**
	 * Prepare limits and might entries with enriched HTML.
	 * @param {boolean} isPlay  Whether in play mode (uses derived data)
	 * @returns {Promise<{limits: object[], might: object[]}>}
	 */
	async #prepareLimitsAndMight(isPlay) {
		const sys = this.system;
		const limitsSource = isPlay ? (sys.derivedLimits || sys.limits) : sys.limits || [];
		const limits = await Promise.all(
			limitsSource.map(async (limit) => ({
				...limit,
				enrichedOutcome: await enrichHTML(limit.outcome, this.document),
			})),
		);
		const might = await Promise.all(
			(isPlay ? (sys.derivedMight || sys.might) : sys.might || []).map(async (entry) => ({
				...entry,
				enrichedDescription: await enrichHTML(entry.description, this.document),
			})),
		);
		return { limits, might };
	}

	/* -------------------------------------------- */
	/*  Event Handlers & Actions                    */
	/* -------------------------------------------- */

	static async #onSubmitChallengeForm(_event, _form, formData) {
		const submitData = formData.object;

		await this._updateEmbeddedFromForm(submitData);

		// Notify story tags of effect changes
		this._notifyStoryTags();

		await this.document.update(submitData);
	}

	static async #onAddLimit(_event, _target) {
		const limits = [...this.system.limits, ChallengeData.newLimit()];
		await this.document.update({ "system.limits": limits });
	}

	static async #onRemoveLimit(_event, target) {
		if (!(await confirmDelete("LITM.Terms.limit"))) return;
		await removeAtIndex(this.document, "system.limits", Number(target.dataset.index));
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
		await removeAtIndex(this.document, "system.might", Number(target.dataset.index));
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
		const itemId = target.closest("[data-item-id]")?.dataset.itemId;
		if (!itemId) return;
		if (!(await confirmDelete("TYPES.Item.addon"))) return;
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
