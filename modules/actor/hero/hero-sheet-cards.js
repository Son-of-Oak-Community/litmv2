import { LitmActorSheet } from "../../sheets/base-actor-sheet.js";
import {
	FELLOWSHIP_KEY,
	fellowshipSlot,
	moveCard,
} from "../../sheets/card-order.js";
import { isDescriptionShort } from "../../sheets/description-fit.js";
import { PrintedCardsMixin } from "../../sheets/printed-cards-mixin.js";
import { FLAGS } from "../../system/config.js";
import { HeroSheet } from "./hero-sheet.js";

/**
 * Printed-card hero variant: tags lead, quest and tracks recede, portrait
 * always framed. The card face and flip come from
 * `PrintedCardsMixin` (litmv2.css §5b); the hero panel and kit live under
 * `.litm-hero-cards` (§25);
 * `cardsLayout` switches the few template branches that differ.
 */
export class HeroSheetCards extends PrintedCardsMixin(HeroSheet) {
	static DEFAULT_OPTIONS = {
		classes: ["litm-hero-cards"],
		// Opens as wide as the Landscape sheet, so the themes row fits.
		position: { width: 1280 },
		actions: {
			toggleHeroPanel: HeroSheetCards._onToggleHeroPanel,
		},
	};

	/** Class on the sheet root while the wide portrait panel is folded away. */
	static PANEL_COLLAPSED_CLASS = "litm-hero-cards--panel-collapsed";

	/** Root class that enables the panel's fold transition while it runs. */
	static PANEL_ANIMATING_CLASS = "litm-hero-cards--panel-animating";

	/** Panel fold state; seeded from the client setting, then kept here so a re-render never snaps back. */
	#panelCollapsed = null;

	/** @type {ResizeObserver|null} */
	#resizeObserver = null;

	/** Apply a panel state to the sheet root and the toggle's ARIA. */
	#applyPanelCollapsed(collapsed) {
		// Only the art layout has a panel to fold (and a toggle to unfold it).
		const hasPanel = !!this.element.querySelector(".litm--play-header--art");
		this.element.classList.toggle(
			HeroSheetCards.PANEL_COLLAPSED_CLASS,
			hasPanel && collapsed,
		);
		this.element
			.querySelector(".litm--hero-panel-toggle")
			?.setAttribute("aria-expanded", String(!collapsed));
	}

	/**
	 * Fold or unfold the portrait panel. Remembered per client (a client
	 * setting), so every Cards sheet this user opens keeps the same choice.
	 * @this {HeroSheetCards}
	 */
	static async _onToggleHeroPanel() {
		this.#panelCollapsed = !this.#panelCollapsed;
		const root = this.element;
		root.classList.add(HeroSheetCards.PANEL_ANIMATING_CLASS);
		this.#applyPanelCollapsed(this.#panelCollapsed);
		const folds = root
			.getAnimations({ subtree: true })
			.filter((a) => a instanceof CSSTransition);
		Promise.allSettled(folds.map((a) => a.finished)).then(() =>
			root.classList.remove(HeroSheetCards.PANEL_ANIMATING_CLASS),
		);
		this.#measureDescription();
		await game.settings.set(
			"litmv2",
			"heroPanelCollapsed",
			this.#panelCollapsed,
		);
	}

	/**
	 * Decide whether the description needs its fade and the name toggle.
	 * Stateless: it only sets classes and attributes from the current DOM, so
	 * any render, full or partial, leaves it right. While hidden (folded
	 * panel, minimised window) the box keeps its last state and the name,
	 * still shown in the folded header, is only a label.
	 */
	#measureDescription() {
		const button = this.element.querySelector(".litm--hero-name__toggle");
		// The "click to toggle" tooltip shows only where a click does something.
		const offerToggle = (el, on) => {
			if (!el) return;
			if (on)
				el.dataset.tooltip = game.i18n.localize(
					"LITM.Ui.click_toggle_description",
				);
			else delete el.dataset.tooltip;
		};
		const body = this.element.querySelector(
			".litm--hero-description .theme-card__description-body",
		);
		if (!body || body.offsetParent === null) {
			if (button) button.disabled = true;
			offerToggle(button, false);
			return;
		}
		const box = body.parentElement;
		const clampPx = Number.parseFloat(getComputedStyle(body).fontSize) * 6;
		const short = isDescriptionShort(body.scrollHeight, clampPx);
		box.classList.toggle("is-short", short);
		// The wide layout leaves the description unclamped: nothing to toggle.
		const canToggle =
			!short &&
			(box.classList.contains("is-expanded") ||
				getComputedStyle(body).maxHeight !== "none");
		// The toggle handler skips a static box; the name button is disabled
		// (out of the tab order) while it would do nothing.
		box.classList.toggle("is-static", !canToggle);
		offerToggle(box, canToggle);
		offerToggle(button, canToggle);
		if (button) button.disabled = !canToggle;
	}

	/**
	 * Foundry disables every control on a sheet the viewer cannot edit. Folding
	 * the panel saves nothing to the hero, so a viewer keeps it.
	 * @override
	 */
	_toggleDisabled(disabled) {
		super._toggleDisabled(disabled);
		for (const button of this.element.querySelectorAll(
			".litm--hero-panel-toggle",
		))
			button.disabled = false;
	}

	/**
	 * Bound on the frame, which outlives part re-renders, so it is added once.
	 * Cards only: on the other hero sheets a click on the card toggles its note.
	 * @override
	 */
	async _renderFrame(options) {
		const frame = await super._renderFrame(options);
		frame.addEventListener("dblclick", (event) =>
			this._onBannerDblClick(event),
		);
		return frame;
	}

	/**
	 * Double-clicking a theme card's banner opens that theme's sheet, or the
	 * Fellowship's sheet for the Fellowship card; the backpack banner opens
	 * the backpack. In Edit mode this replaces the banners' edit buttons, and
	 * the Statuses banner adds a status. In Play mode, Statuses and Moment of
	 * Fulfillment, which have no sheet of their own, switch to Edit mode.
	 * Owners only: a viewer gets no shortcuts into documents they cannot edit.
	 * @param {MouseEvent} event
	 * @protected
	 */
	_onBannerDblClick(event) {
		if (!this.isEditable || event.target.closest("button")) return;
		const kit = event.target.closest(".litm-kit-card > legend")?.parentElement;
		if (kit?.matches(".litm-kit-card--backpack"))
			return this.document.system.backpackItem?.sheet.render(true);
		if (this._isEditMode && kit?.matches(".litm-kit-card--statuses"))
			return LitmActorSheet._onAddStoryTag.call(this, event, {
				dataset: { tagType: "status_tag" },
			});
		if (
			!this._isEditMode &&
			kit?.matches(".litm-kit-card--statuses, .litm-kit-card--mof")
		)
			return this._onChangeSheetMode();
		const card = event.target.closest(".theme-card > legend")?.parentElement;
		if (!card) return;
		const doc = card.matches("[data-banner='fellowship']")
			? this.document.system.fellowshipActor
			: this.document.items.get(card.dataset.itemId ?? card.dataset.id);
		doc?.sheet.render(true);
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.cardsLayout = true;
		// The "What do you do?" buttons act as this hero; a viewer gets none.
		context.viewOnlyActions = !this.isEditable;
		context.fellowshipSlot = fellowshipSlot(
			this.document.getFlag("litmv2", FLAGS.fellowshipIndex),
			context.themes?.length ?? 0,
		);
		return context;
	}

	/* -------------------------------------------- */
	/*  Card reordering                             */
	/* -------------------------------------------- */

	/** Drag type for the Fellowship card, which is not an item of this hero. */
	static FELLOWSHIP_CARD_DRAG = "litmv2.FellowshipCard";

	/** @override */
	_onDragStart(event) {
		// A card's banner is its drag handle. The item id stays on the card, not
		// the banner: Foundry's sort reads the drop target's nearest id and its
		// siblings, which must be the cards.
		const card = event.currentTarget.closest(".theme-card");
		if (!card || card === event.currentTarget) return super._onDragStart(event);
		const data = card.matches("[data-fellowship-card]")
			? {
					type: HeroSheetCards.FELLOWSHIP_CARD_DRAG,
					actorUuid: this.document.uuid,
				}
			: this.document.items.get(card.dataset.itemId)?.toDragData();
		if (data) event.dataTransfer.setData("text/plain", JSON.stringify(data));
	}

	/** @override */
	async _onDrop(event) {
		const data =
			foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
		if (data.type !== HeroSheetCards.FELLOWSHIP_CARD_DRAG)
			return super._onDrop(event);
		if (data.actorUuid !== this.document.uuid || !this.isEditable) return;
		return this.#sortThemesRow(event, FELLOWSHIP_KEY);
	}

	/** @override */
	async _onSortItem(event, item) {
		if (item.type === "theme" && (await this.#sortThemesRow(event, item.id)))
			return;
		return super._onSortItem(event, item);
	}

	/**
	 * Reorder the themes row as one sequence, the Fellowship card included,
	 * then write back the themes' sort and the Fellowship's slot together. A theme
	 * moved past the Fellowship shifts it, as it would any card.
	 * @param {DragEvent} event
	 * @param {string} source  The dragged theme's id, or FELLOWSHIP_KEY.
	 * @returns {Promise<boolean>} False when the drop is outside the row.
	 */
	async #sortThemesRow(event, source) {
		const target = event.target.closest(
			".litm-hero-board__themes > .theme-card",
		);
		if (!target) return false;
		const keyOf = (card) =>
			card.matches("[data-fellowship-card]")
				? FELLOWSHIP_KEY
				: card.dataset.itemId;
		const cards = [
			...target.parentElement.querySelectorAll(":scope > .theme-card"),
		];
		const order = moveCard(cards.map(keyOf), source, keyOf(target));
		if (!order) return true;
		const themeIds = order.filter((key) => key !== FELLOWSHIP_KEY);
		// One update, so the row re-renders once and never lands half-moved.
		const update = {
			items: themeIds.map((_id, i) => ({
				_id,
				sort: (i + 1) * CONST.SORT_INTEGER_DENSITY,
			})),
		};
		if (order.includes(FELLOWSHIP_KEY))
			update[`flags.litmv2.${FLAGS.fellowshipIndex}`] =
				order.indexOf(FELLOWSHIP_KEY);
		await this.document.update(update);
		return true;
	}

	/** @override */
	async _onRender(context, options) {
		await super._onRender(context, options);
		// A hero with neither art nor a description has nothing to show in the panel.
		const emptyPanel =
			!!this.element.querySelector(".litm--play-portrait--placeholder") &&
			!this.element.querySelector(".litm--hero-description");
		this.#panelCollapsed ??=
			game.settings.get("litmv2", "heroPanelCollapsed") || emptyPanel;
		this.#applyPanelCollapsed(this.#panelCollapsed);
		if (!this.element.querySelector(".litm--hero-description")) return;
		this.#measureDescription();
		// Resizing can cross the clamp or the wide breakpoint without a re-render.
		this.#resizeObserver ??= new ResizeObserver(() =>
			this.#measureDescription(),
		);
		this.#resizeObserver.observe(this.element);
	}

	/** @override */
	_onClose(options) {
		this.#resizeObserver?.disconnect();
		this.#resizeObserver = null;
		super._onClose(options);
	}
}
