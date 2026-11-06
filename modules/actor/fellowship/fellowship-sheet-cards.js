import { PrintedCardsMixin } from "../../sheets/printed-cards-mixin.js";
import { FellowshipSheet } from "./fellowship-sheet.js";

/**
 * Printed-card Fellowship variant: story tags and statuses, the Fellowship
 * theme and the story themes as one row of printed cards. The card face and
 * flip come from `PrintedCardsMixin` (litmv2.css §25b), the board from §25c.
 * Edit mode keeps the classic form, with the cards' banners.
 */
export class FellowshipSheetCards extends PrintedCardsMixin(FellowshipSheet) {
	static DEFAULT_OPTIONS = {
		classes: ["litm-fellowship-cards"],
	};

	static PLAY_CONTENT_TEMPLATE =
		"systems/litmv2/templates/actor/fellowship-cards-play-content.html";

	/** @type {ResizeObserver|null} */
	#resizeObserver = null;

	/**
	 * The shared partials switch to their card rows, and the description to
	 * its clamp, on `cardsLayout`. The header part reads it as the hero's
	 * portrait panel, so the header does not get it.
	 * @override
	 */
	async _preparePartContext(partId, context, options) {
		const partContext = await super._preparePartContext(
			partId,
			context,
			options,
		);
		return partId === "header"
			? partContext
			: { ...partContext, cardsLayout: true };
	}

	/** A description that fits its clamp gets no fade and no toggle. */
	#measureDescription() {
		const box = this.element.querySelector(".litm--hero-description");
		const body = box?.querySelector(".theme-card__description-body");
		if (!body || body.offsetParent === null) return;
		// Against the clamp (6em in §25), not the live box, which a short one unclamps.
		const clampPx = Number.parseFloat(getComputedStyle(body).fontSize) * 6;
		const short = body.scrollHeight <= clampPx;
		box.classList.toggle("is-short", short);
		box.classList.toggle("is-static", short);
		if (short) delete box.dataset.tooltip;
		else
			box.dataset.tooltip = game.i18n.localize(
				"LITM.Ui.click_toggle_description",
			);
	}

	/** @override */
	async _onRender(context, options) {
		await super._onRender(context, options);
		this.#measureDescription();
		// Resizing the window can cross the clamp without a re-render.
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
