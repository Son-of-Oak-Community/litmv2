import { ChallengeSheet } from "../actor/challenge/challenge-sheet.js";
import { FellowshipSheet } from "../actor/fellowship/fellowship-sheet.js";
import { HeroSheet } from "../actor/hero/hero-sheet.js";
import { JourneySheet } from "../actor/journey/journey-sheet.js";
import { FLAGS } from "../system/config.js";
import { LitmActorSheet } from "./base-actor-sheet.js";
import { FELLOWSHIP_KEY, fellowshipSlot, moveCard } from "./card-order.js";
import { isDescriptionShort } from "./description-fit.js";

const LANDSCAPE_OPTIONS = {
	classes: ["litm-landscape"],
	position: {
		width: LitmActorSheet.LANDSCAPE_WIDTH,
	},
};

/**
 * The hero landscape variant starts wider so the responsive board layout
 * (4-up themes, split inventory/fellowship band, 3-up story themes) kicks
 * in by default. The layout itself is driven by container queries on
 * .litm-hero-sheet, so resizing either variant past the breakpoint shows
 * the same wide layout; this just picks the initial width.
 */
export class HeroSheetLandscape extends HeroSheet {
	static DEFAULT_OPTIONS = {
		classes: ["litm-landscape"],
		position: { width: 1280 },
	};
}

/**
 * Printed-card hero variant: tags lead, quest and tracks recede, portrait
 * always framed. Styling lives under `.litm-hero-cards` (litmv2.css §25);
 * `cardsLayout` switches the few template branches that differ.
 */
export class HeroSheetCards extends HeroSheet {
	static DEFAULT_OPTIONS = {
		classes: ["litm-hero-cards"],
		// Opens as wide as the Landscape sheet, so the themes row fits.
		position: { width: 1280 },
		actions: {
			toggleHeroPanel: HeroSheetCards._onToggleHeroPanel,
			flipThemeCard: HeroSheetCards._onFlipThemeCard,
		},
	};

	/** Class on the sheet root while the wide portrait panel is folded away. */
	static PANEL_COLLAPSED_CLASS = "litm-hero-cards--panel-collapsed";

	/** Theme cards turned to their back (the note), by `data-flip-key`; kept across re-renders. */
	#flipped = new Set();

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
		this.#applyPanelCollapsed(this.#panelCollapsed);
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
	 * any render, full or partial, leaves it right. Skipped while hidden
	 * (folded panel, minimised window), keeping the last state.
	 */
	#measureDescription() {
		const body = this.element.querySelector(
			".litm--hero-description .theme-card__description-body",
		);
		if (!body || body.offsetParent === null) return;
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
		if (canToggle)
			box.dataset.tooltip = game.i18n.localize(
				"LITM.Ui.click_toggle_description",
			);
		else delete box.dataset.tooltip;
		const button = this.element.querySelector(".litm--hero-name__toggle");
		if (button) button.disabled = !canToggle;
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
	 * Play mode: double-clicking a theme card's banner opens that theme's
	 * sheet, or the Fellowship's sheet for the Fellowship card.
	 * @param {MouseEvent} event
	 * @protected
	 */
	_onBannerDblClick(event) {
		if (this._isEditMode || event.target.closest("button")) return;
		const card = event.target.closest(".theme-card > legend")?.parentElement;
		if (!card) return;
		const doc = card.matches("[data-banner='fellowship']")
			? this.document.system.fellowshipActor
			: this.document.items.get(card.dataset.itemId ?? card.dataset.id);
		doc?.sheet.render(true);
	}

	/**
	 * Turn a theme card over: the back shows its note. A half-turn out, the
	 * face swaps, a half-turn back in; no motion when the user asks for less.
	 * @this {HeroSheetCards}
	 */
	static _onFlipThemeCard(_event, target) {
		const card = target.closest(".theme-card[data-flip-key]");
		if (!card) return;
		const key = card.dataset.flipKey;
		const flipped = !this.#flipped.has(key);
		if (flipped) this.#flipped.add(key);
		else this.#flipped.delete(key);
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
			return this.#applyFlip(card, flipped);
		// Perspective draws the card's near edge taller than the card, which
		// can overflow the scrolling pane and flash a scrollbar. Shrinking by
		// that edge's depth keeps the turning card within its own height.
		const depth = 1 / 8; // half the card's width over the perspective
		const perspective = `perspective(${card.offsetWidth / (2 * depth)}px)`;
		const turn = (from, to, easing) =>
			card.animate(
				[0, 0.25, 0.5, 0.75, 1].map((offset) => {
					const angle = from + (to - from) * offset;
					const sin = Math.abs(Math.sin((angle * Math.PI) / 180));
					const scale = 1 - 1.1 * depth * sin;
					return {
						offset,
						transform: `${perspective} rotateY(${angle}deg) scale(${scale})`,
					};
				}),
				{ duration: 140, easing },
			).finished;
		turn(0, 90, "ease-in").then(() => {
			this.#applyFlip(card, flipped);
			turn(-90, 0, "ease-out");
		});
	}

	/** Show a card's back or face. The back sits under the banner, so it is placed from the banner's measured bottom. */
	#applyFlip(card, flipped) {
		// A note deleted while flipped leaves no back: show the face.
		flipped &&= !!card.querySelector(":scope > .theme-card__back");
		const legend = card.querySelector(":scope > legend");
		card.style.setProperty(
			"--litm-back-top",
			`${legend.offsetTop + legend.offsetHeight}px`,
		);
		card.classList.toggle("is-flipped", flipped);
		for (const face of card.querySelectorAll(
			":scope > :not(legend, .theme-card__back)",
		))
			face.inert = flipped;
		card
			.querySelector("[data-action='flipThemeCard']")
			?.setAttribute("aria-pressed", String(flipped));
	}

	/** @override */
	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.cardsLayout = true;
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
		this.#panelCollapsed ??= game.settings.get("litmv2", "heroPanelCollapsed");
		this.#applyPanelCollapsed(this.#panelCollapsed);
		for (const card of this.element.querySelectorAll(
			".theme-card[data-flip-key]",
		))
			if (this.#flipped.has(card.dataset.flipKey)) this.#applyFlip(card, true);
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

export class ChallengeSheetLandscape extends ChallengeSheet {
	static DEFAULT_OPTIONS = LANDSCAPE_OPTIONS;
}

export class JourneySheetLandscape extends JourneySheet {
	static DEFAULT_OPTIONS = LANDSCAPE_OPTIONS;
}

export class FellowshipSheetLandscape extends FellowshipSheet {
	static DEFAULT_OPTIONS = LANDSCAPE_OPTIONS;
}
