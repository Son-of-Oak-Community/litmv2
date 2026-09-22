import { localize as t } from "../utils.js";
import { mountPlayersHud } from "./players-hud.js";

/**
 * The Narrator's call-for-roll control, on the main screen.
 *
 * It used to be the first of four stacked buttons at the foot of the story-tag
 * sidebar — which meant opening a panel to reach the thing you reach for most.
 * Filip: he always imagined it as a prominent part of the main screen rather
 * than in a menu. So it sits directly above the player list, "right where the
 * notifications would go", sharing that region with the roll-dialog HUD strip:
 * the one place on screen showing who is at the table becomes the place you
 * call on them.
 *
 * GM only, and gated on `isGM` alone. Calling for a roll is an unconditional
 * Narrator capability — `player_initiated_rolls` decides whether *players* may
 * also start one, and the two are not two halves of a toggle.
 */
export class CallForRollHud {
	#container = null;

	render() {
		if (!game.user.isGM) return this.#teardown();

		if (!this.#container) {
			this.#container = document.createElement("div");
			this.#container.id = "litm-call-for-roll-hud";
			this.#container.classList.add("litm-call-for-roll-hud");
			const button = document.createElement("button");
			button.type = "button";
			button.className = "litm-call-for-roll-hud__button";
			const icon = document.createElement("i");
			icon.className = "fa-solid fa-feather";
			icon.ariaHidden = "true";
			const label = document.createElement("span");
			label.textContent = t("LITM.Ui.narrator_call_open");
			button.append(icon, label);
			this.#container.append(button);
			this.#container.addEventListener("click", async () => {
				const { CallForRollApp } = await import(
					"../apps/roll/call-for-roll.js"
				);
				CallForRollApp.open();
			});
		}

		mountPlayersHud(this.#container);
	}

	#teardown() {
		this.#container?.remove();
		this.#container = null;
	}
}
