import { localize as t } from "../utils.js";
import { mountPlayersHud } from "./players-hud.js";

/**
 * Pickup is for a begun camp this client is not already viewing. Setup is the
 * Narrator's private prep, and their sheet button already reopens it.
 */
export function shouldShowCampPickup({ state, rendered }) {
	return !!(state && state.phase === "active" && !rendered);
}

/**
 * The name a camp's scene goes by for this user, or "" for a map they cannot
 * see. Same rule as Foundry's scene navigation, so a hidden map is not exposed.
 */
export function campSceneLabel(scene) {
	if (!scene) return "";
	return scene.active || scene.isView || scene.visible
		? scene.navName || scene.name
		: "";
}

/**
 * The camp's counterpart to the roll-dialog HUD strip: a "rejoin" entry above
 * the player list while a camp or sojourn is running. Players only ever reach
 * the camp through the Begin Camp broadcast, so after a reload this is their
 * one way back to it.
 */
export class CampingHud {
	#container = null;

	async render() {
		if (!document.getElementById("players")) return;

		if (!this.#container) {
			this.#container = document.createElement("div");
			this.#container.id = "litm-camping-hud";
			this.#container.classList.add(
				"litm-roll-dialog-hud",
				"litm-camping-hud",
				"is-hidden",
			);
			this.#container.addEventListener("click", (event) => {
				const target = event.target.closest("[data-scene-id]");
				if (!target) return;
				game.litmv2.LitmCampingScene?.open({
					sceneId: target.dataset.sceneId,
				});
			});
		}
		mountPlayersHud(this.#container);

		// Only the camp being viewed hides; another scene's camp stays listed.
		const app = game.litmv2.LitmCampingScene;
		const viewing = app?.instance?.rendered ? app.sceneId : null;
		const entries =
			game.scenes
				?.filter((scene) =>
					shouldShowCampPickup({
						state: scene.getFlag("litmv2", "camping"),
						rendered: scene.id === viewing,
					}),
				)
				.map((scene) => {
					const state = scene.getFlag("litmv2", "camping");
					return {
						sceneId: scene.id,
						title:
							state.type === "sojourn"
								? game.i18n.format("LITM.Ui.camping_sojourn_title", {
										duration: t(
											`LITM.Ui.camping_duration_${state.sojournDuration}`,
										),
									})
								: t("LITM.Ui.camping_camp"),
						// The entry itself stays for a hidden map, to rejoin by.
						sceneName: campSceneLabel(scene),
					};
				}) ?? [];

		if (!entries.length) {
			this.#container.innerHTML = "";
			this.#container.classList.add("is-hidden");
			return;
		}

		this.#container.innerHTML =
			await foundry.applications.handlebars.renderTemplate(
				"systems/litmv2/templates/hud/camping-hud.html",
				{ entries },
			);
		this.#container.classList.remove("is-hidden");
	}
}
