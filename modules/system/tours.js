import { error, info } from "../logger.js";
import { getStoryTagSidebar } from "../utils.js";
import { FLAGS } from "./config.js";
import { createSampleHero } from "./sample-hero.js";
import { LitmSettings } from "./settings.js";

const { Tour } = foundry.nue;

/**
 * Wait for a DOM element matching `selector` to appear, polling every 100ms.
 * Rejects on timeout so the tour can handle a missing element gracefully.
 * @param {string} selector
 * @param {number} [timeout=3000]
 * @returns {Promise<Element>}
 */
function waitForElement(selector, timeout = 3000) {
	return new Promise((resolve, reject) => {
		const el = document.querySelector(selector);
		if (el) return resolve(el);

		const start = Date.now();
		const interval = setInterval(() => {
			const found = document.querySelector(selector);
			if (found) {
				clearInterval(interval);
				resolve(found);
			} else if (Date.now() - start > timeout) {
				clearInterval(interval);
				reject(new Error(`Tour element not found: "${selector}" (timed out)`));
			}
		}, 100);
	});
}

/**
 * Custom Tour subclass for Legend in the Mist.
 * Handles custom step actions like opening the sample hero sheet
 * or activating sidebar tabs before a step is shown.
 */
export class LitmTour extends Tour {
	/**
	 * Optional actor to use as the tour target instead of searching
	 * for the sample hero by flag. Set externally before starting the tour.
	 * @type {Actor|null}
	 */
	targetActor = null;

	/**
	 * Whether to drop the fellowship "drop a themebook" step. Snapshotted once
	 * at start() so mid-tour state changes don't shift step indices.
	 * @type {boolean}
	 */
	#skipSetupTheme = false;

	/** @override */
	async start() {
		// The "setup-theme" step points at the fellowship's "drop a themebook"
		// CTA, which only exists before a theme is in place. Decide once, up
		// front, whether to include it (#99).
		this.#skipSetupTheme =
			this.id === "fellowship" && !!game.litmv2?.fellowship?.system?.theme;
		return super.start();
	}

	/** @override */
	get steps() {
		const steps = super.steps;
		if (this.#skipSetupTheme) {
			return steps.filter((step) => step.id !== "setup-theme");
		}
		return steps;
	}

	/** @override */
	async _renderStep() {
		// Some steps target elements that only exist in certain world states. If
		// the target is missing, skip the step rather than letting Foundry throw
		// and abort the whole tour (#99).
		const step = this.currentStep;
		if (step?.selector && !this.targetElement) {
			// Foundry already console.warns the missing element; this is just the
			// handled resolution, so log it at info to avoid a double warning.
			info(
				`Tour [${this.id}] target "${step.selector}" missing — skipping step`,
			);
			return this.hasNext ? this.next() : this.complete();
		}
		return super._renderStep();
	}

	/**
	 * Take down whatever the tour put up.
	 *
	 * The Narrator's Call tour opens a **real** shared roll, deliberately —
	 * it is the feature being taught, and a mock would teach the mock. That
	 * roll sets the `rollDialogOwner` flag, which advertises it on every
	 * client's HUD strip, so leaving it up leaves the table with a "click to
	 * join" invitation to a demonstration.
	 *
	 * Idempotent: it runs on completion and on exit, and the two can both
	 * happen for one tour.
	 */
	async #teardownDemo() {
		const hero =
			this.targetActor ??
			game.actors.find(
				(a) => a.type === "hero" && a.getFlag("litmv2", "isSampleHero"),
			);
		await foundry.applications.instances.get("litm-call-for-roll")?.close();
		if (hero?.sheet?.hasRollDialog) {
			const dialog = hero.sheet.rollDialogInstance;
			if (dialog.rendered) await dialog.close();
			await hero.unsetFlag("litmv2", FLAGS.rollDialogOwner);
		}
		if (hero?.sheet?.rendered) await hero.sheet.close();

		const fellowship = game.litmv2?.fellowship;
		if (fellowship?.sheet?.rendered) await fellowship.sheet.close();
	}

	/** @override */
	async _postStep() {
		await super._postStep();
		// `_postStep` also runs between steps, where `hasNext` is still the
		// *old* step's — so this is the completion path and nothing else.
		if (!this.hasNext) await this.#teardownDemo();
	}

	/**
	 * Quitting is not completing, and the demonstration roll has to come down
	 * either way. Every exit route lands here: Escape
	 * (`client-keybindings.mjs` → `Tour.activeTour.exit()`), the tour card's
	 * own close button (`_onButtonClick`, case "exit"), and `progress()`'s
	 * catch when a step fails to render.
	 *
	 * `Tour#exit` is synchronous and does not await `_postStep`, so the
	 * teardown is kicked off rather than awaited — there is no caller to hand
	 * the promise to.
	 *
	 * @override
	 */
	exit() {
		const result = super.exit();
		this.#teardownDemo().catch(console.error);
		return result;
	}

	/** @override */
	async _preStep() {
		await super._preStep();

		const action = this.currentStep?.action;
		if (action === "openSampleHero") await this.#openSampleHero();
		else if (action === "switchToPlayMode") await this.#switchToPlayMode();
		else if (action === "openFellowshipSheet")
			await this.#openFellowshipSheet();
		else if (action === "ensureSampleTags") await this.#ensureSampleTags();
		else if (action === "openRollCall") await this.#openRollCall();
		else if (action === "openCalledRoll") await this.#openCalledRoll();
		else if (action?.startsWith("activateSidebar:")) {
			const tab = action.split(":")[1];
			await ui[tab]?.activate();
		}

		// Give an async-rendered target a chance to appear before the step shows.
		// Swallow the timeout silently — a target that never materialises is
		// logged and skipped in _renderStep (#99), so warning here would just
		// duplicate that.
		const selector = this.currentStep?.selector;
		if (selector) await waitForElement(selector).catch(() => {});
	}

	/**
	 * Get the hero actor for this tour.
	 * @returns {Actor|null}
	 */
	async #getOrCreateHero() {
		// Validate targetActor still exists in the collection
		if (this.targetActor && !game.actors.has(this.targetActor.id)) {
			this.targetActor = null;
		}
		if (this.targetActor) return this.targetActor;

		const existing = game.actors.find(
			(a) => a.type === "hero" && a.getFlag("litmv2", "isSampleHero"),
		);
		if (existing) return existing;

		// Fall back to creating the sample hero
		const hero = await createSampleHero();
		if (hero) this.targetActor = hero;
		return hero ?? null;
	}

	/**
	 * Find the target hero actor and open its sheet.
	 */
	async #openSampleHero() {
		const hero = await this.#getOrCreateHero();
		if (!hero) return;

		if (!hero.sheet.rendered) {
			await hero.sheet.render(true);
		}
	}

	/**
	 * Open the singleton fellowship sheet.
	 */
	async #openFellowshipSheet() {
		const fellowship = game.litmv2?.fellowship;
		if (!fellowship) return;
		await fellowship.sheet.render(true);
	}

	/**
	 * If the target hero sheet is in edit mode, switch it to play mode.
	 */
	async #switchToPlayMode() {
		await this.#openSampleHero();

		const hero = await this.#getOrCreateHero();
		if (!hero?.sheet?.rendered) return;

		const sheet = hero.sheet;
		if (sheet._isEditMode) {
			sheet._mode = 0; // MODES.PLAY
			await sheet.render(true);
		}
	}

	/**
	 * Open the Narrator's Call picker.
	 */
	async #openRollCall() {
		const { CallForRollApp } = await import("../apps/roll/call-for-roll.js");
		CallForRollApp.open();
		await waitForElement("#litm-call-for-roll").catch(() => {});
	}

	/**
	 * Open a real shared roll on the tour's hero, so the two halves of the
	 * dialog can be pointed at rather than described.
	 *
	 * Deliberately the real path and not a mock — this is the feature being
	 * taught. It lands on the sample hero, who has no player owner, so the roll
	 * resolves to the Narrator and nobody else's screen is interrupted by a
	 * tutorial. {@link _postStep} closes it and clears the advert at the end.
	 */
	async #openCalledRoll() {
		const hero = await this.#getOrCreateHero();
		if (!hero) return;
		const callApp = foundry.applications.instances.get("litm-call-for-roll");
		await callApp?.close();
		const { openSharedRoll } = await import("../apps/roll/roll-request.js");
		await openSharedRoll({ actorId: hero.id });
		await waitForElement(`#litm-roll-dialog-${hero.id}`).catch(() => {});
	}

	/**
	 * Ensure the story tag sidebar has at least one tag and one status
	 * so tour selectors have something to point at.
	 */
	async #ensureSampleTags() {
		const sidebar = getStoryTagSidebar();
		if (!sidebar || typeof sidebar.addTag !== "function") return;

		await sidebar.activate();
		const tags = sidebar.tags ?? [];
		const hasTag = tags.some((t) => t.type === "story_tag");
		const hasStatus = tags.some((t) => t.type === "status_tag");

		if (!hasTag) await sidebar.addTag("story", "story_tag");
		if (!hasStatus) await sidebar.addTag("story", "status_tag");
	}
}

/**
 * Register all Legend in the Mist tours.
 */
let _toursPromise = null;
export function registerTours() {
	if (!_toursPromise) _toursPromise = _doRegisterTours();
	return _toursPromise;
}
async function _doRegisterTours() {
	info("Registering Tours...");
	const tours = [
		["heroSheetBasics", "tours/hero-sheet-basics.json"],
		["storyTagSidebar", "tours/story-tag-sidebar.json"],
		// GM-only (`restricted` in its JSON): calling for a roll is the
		// Narrator's step, so the tutorial is theirs too.
		["narratorsCall", "tours/narrators-call.json"],
	];

	if (LitmSettings.useFellowship) {
		tours.push(["fellowship", "tours/fellowship.json"]);
	}

	for (const [id, path] of tours) {
		try {
			const tour = await LitmTour.fromJSON(`systems/litmv2/${path}`);
			game.tours.register("litmv2", id, tour);
		} catch (err) {
			error(`Failed to register tour "${id}"`, err);
		}
	}
}
