/**
 * Web Animations API choreography for the welcome overlay. Lifted out of
 * the overlay class so the latter stays focused on slide flow and form
 * state.
 *
 * Each exported function accepts an `AnimationContext` adapter:
 *   - `el`                 The overlay root element.
 *   - `reducedMotion`      Whether the user requested reduced motion.
 *   - `setAnimating(bool)` Toggles the "animation in flight" flag on the
 *                          calling overlay (used to suppress concurrent
 *                          navigation events).
 *   - `renderCurrentSlide()` Renders the slide that should now be visible.
 *
 * @typedef {{
 *   el: HTMLElement,
 *   reducedMotion: boolean,
 *   setAnimating: (animating: boolean) => void,
 *   renderCurrentSlide: () => Promise<void>,
 * }} AnimationContext
 */

/**
 * Animate an element via the Web Animations API and resolve when finished.
 * @param {Element} el
 * @param {Keyframe[]} keyframes
 * @param {KeyframeAnimationOptions} options
 * @returns {Promise<void>}
 */
function animate(el, keyframes, options) {
	return new Promise((resolve) => {
		const anim = el.animate(keyframes, {
			fill: "forwards",
			...options,
		});
		anim.onfinish = () => resolve();
	});
}

/**
 * Reveal the overlay: background fades in, logo scales in, content children
 * stagger up. Honours reduced-motion by skipping animation entirely.
 *
 * @param {AnimationContext} ctx
 */
export async function animateEnter(ctx) {
	const { el, reducedMotion, setAnimating } = ctx;
	if (!el) return;

	const bg = el.querySelector(".litm--welcome-overlay__bg");
	const logo = el.querySelector(".litm--welcome-overlay__logo");
	const content = el.querySelector(".litm--welcome-overlay__content");

	if (reducedMotion) {
		el.style.opacity = "1";
		return;
	}

	setAnimating(true);

	// Hide children before revealing the container to prevent flash
	if (bg) bg.style.opacity = "0";
	if (logo) logo.style.opacity = "0";
	if (content) {
		for (const child of content.children) child.style.opacity = "0";
	}

	// Now reveal the container — children are hidden so no flash
	el.style.opacity = "1";

	const animations = [];

	if (bg) {
		animations.push(
			animate(bg, [{ opacity: 0 }, { opacity: 1 }], { duration: 500 }),
		);
	}

	if (logo) {
		animations.push(
			animate(
				logo,
				[
					{ opacity: 0, transform: "scale(0.9)" },
					{ opacity: 1, transform: "scale(1)" },
				],
				{ duration: 400, delay: 200, easing: "ease-out" },
			),
		);
	}

	if (content?.children.length) {
		for (let i = 0; i < content.children.length; i++) {
			animations.push(
				animate(
					content.children[i],
					[
						{ opacity: 0, transform: "translateY(20px)" },
						{ opacity: 1, transform: "translateY(0)" },
					],
					{ duration: 300, delay: 300 + i * 150, easing: "ease-out" },
				),
			);
		}
	}

	await Promise.all(animations);
	setAnimating(false);
}

/**
 * Dismiss the overlay: slide content fades down, background dissolves.
 *
 * @param {AnimationContext} ctx
 */
export async function animateExit(ctx) {
	const { el, reducedMotion, setAnimating } = ctx;
	if (!el) return;

	if (reducedMotion) {
		el.style.opacity = "0";
		return;
	}

	setAnimating(true);

	const slide = el.querySelector(".litm--welcome-overlay__slides");
	const bg = el.querySelector(".litm--welcome-overlay__bg");

	if (slide) {
		await animate(
			slide,
			[
				{ opacity: 1, transform: "translateY(0)" },
				{ opacity: 0, transform: "translateY(30px)" },
			],
			{ duration: 400, easing: "ease-in" },
		);
	}

	if (bg) {
		await animate(bg, [{ opacity: 1 }, { opacity: 0 }], {
			duration: 400,
			easing: "ease-in",
		});
	}

	setAnimating(false);
}

/**
 * Transition between two slides with a directional sweep. The new slide is
 * rendered between the exit and enter steps via `ctx.renderCurrentSlide`.
 *
 * @param {AnimationContext} ctx
 * @param {"forward"|"backward"} direction
 */
export async function transitionSlide(ctx, direction) {
	const { el, reducedMotion, setAnimating, renderCurrentSlide } = ctx;
	if (!el) return;

	const container = el.querySelector(".litm--welcome-overlay__slides");
	if (!container) return;

	const oldSlide = container.firstElementChild;

	setAnimating(true);

	if (reducedMotion) {
		if (oldSlide) oldSlide.style.opacity = "0";
		await renderCurrentSlide();
		const newSlide = container.firstElementChild;
		if (newSlide) {
			await animate(newSlide, [{ opacity: 0 }, { opacity: 1 }], {
				duration: 200,
			});
		}
		setAnimating(false);
		return;
	}

	const exitX = direction === "forward" ? -100 : 100;
	const enterX = direction === "forward" ? 100 : -100;
	const easing = "cubic-bezier(0.7, 0, 0.3, 1)";

	if (oldSlide) {
		await animate(
			oldSlide,
			[
				{ opacity: 1, transform: "translateX(0)" },
				{ opacity: 0, transform: `translateX(${exitX}px)` },
			],
			{ duration: 400, easing },
		);
	}

	await renderCurrentSlide();
	const newSlide = container.firstElementChild;

	if (newSlide) {
		await animate(
			newSlide,
			[
				{ opacity: 0, transform: `translateX(${enterX}px)` },
				{ opacity: 1, transform: "translateX(0)" },
			],
			{ duration: 400, easing },
		);
	}

	setAnimating(false);
}
