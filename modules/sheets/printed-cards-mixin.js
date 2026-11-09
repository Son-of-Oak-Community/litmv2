/**
 * Printed theme cards for any actor sheet: the `litm--printed-cards` root
 * class turns on the printed-card face (litmv2.css §25b), and a card with a
 * `data-flip-key` and a `.theme-card__back` turns over to its note through
 * the `flipThemeCard` action. Flip state lives on the sheet instance, not in
 * data, so it survives re-renders but not a reopen. It also keeps the
 * description's clamp measured (`_measureDescription`) as the sheet resizes.
 *
 * @param {typeof foundry.applications.api.ApplicationV2} Base
 * @returns {typeof foundry.applications.api.ApplicationV2}
 */
export function PrintedCardsMixin(Base) {
	return class PrintedCards extends Base {
		static DEFAULT_OPTIONS = {
			classes: ["litm--printed-cards"],
			actions: {
				flipThemeCard: PrintedCards._onFlipThemeCard,
			},
		};

		/** Theme cards turned to their back (the note), by `data-flip-key`; kept across re-renders. */
		#flipped = new Set();

		/**
		 * Flipping a card saves nothing to the document, so a viewer keeps it.
		 * @override
		 */
		_toggleDisabled(disabled) {
			super._toggleDisabled(disabled);
			for (const button of this.element.querySelectorAll(
				"[data-action='flipThemeCard']",
			))
				button.disabled = false;
		}

		/**
		 * Turn a theme card over: the back shows its note. A half-turn out, the
		 * face swaps, a half-turn back in; no motion when the user asks for less.
		 * @this {PrintedCards}
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

		/** Show a card's back or face. */
		#applyFlip(card, flipped) {
			// A note deleted while flipped leaves no back: show the face.
			flipped &&= !!card.querySelector(":scope > .theme-card__back");
			card.classList.toggle("is-flipped", flipped);
			for (const face of card.querySelectorAll(
				":scope > :not(legend, .theme-card__back)",
			))
				face.inert = flipped;
			card
				.querySelector("[data-action='flipThemeCard']")
				?.setAttribute("aria-pressed", String(flipped));
		}

		/** @type {ResizeObserver|null} */
		#resizeObserver = null;

		/** Whether a description body fits its clamp (6em in litmv2.css §25).
		 *  Against the clamp, not the live box, which some layouts leave unclamped. */
		_descriptionIsShort(body) {
			const clampPx = Number.parseFloat(getComputedStyle(body).fontSize) * 6;
			return body.scrollHeight <= clampPx;
		}

		/** A description that fits its clamp gets no fade and no toggle. */
		_measureDescription() {
			const box = this.element.querySelector(".litm--hero-description");
			const body = box?.querySelector(".theme-card__description-body");
			if (!body || body.offsetParent === null) return;
			const short = this._descriptionIsShort(body);
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
			for (const card of this.element.querySelectorAll(
				".theme-card[data-flip-key]",
			))
				if (this.#flipped.has(card.dataset.flipKey))
					this.#applyFlip(card, true);
			this._measureDescription();
			// Resizing can cross the clamp or a breakpoint without a re-render.
			this.#resizeObserver ??= new ResizeObserver(() =>
				this._measureDescription(),
			);
			this.#resizeObserver.observe(this.element);
		}

		/** @override */
		_onClose(options) {
			this.#resizeObserver?.disconnect();
			this.#resizeObserver = null;
			super._onClose(options);
		}
	};
}
