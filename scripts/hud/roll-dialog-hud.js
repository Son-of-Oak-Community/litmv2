import { localize as t } from "../utils.js";

/**
 * Minimal HUD widget showing which heroes have active roll dialogs.
 * Injected into the #players panel.
 */
export class RollDialogHud {
	#container = null;

	async render() {
		const parent = document.getElementById("players");
		if (!parent) return;

		if (!this.#container) {
			this.#container = document.createElement("div");
			this.#container.id = "litm-roll-dialog-hud";
			this.#container.classList.add("litm-roll-dialog-hud", "is-hidden");
			this.#container.addEventListener("click", (event) => {
				const target = event.target.closest("[data-actor-id]");
				if (!target) return;
				const actor = game.actors.get(target.dataset.actorId);
				if (!actor?.sheet) return;
				actor.sheet.renderRollDialog();
			});
			parent.prepend(this.#container);
		}

		await this.#renderEntries();
	}

	async #renderEntries() {
		const entries =
			game.actors
				?.filter((a) => {
					const flag = a.getFlag("litmv2", "rollDialogOwner");
					if (!flag || flag.ownerId === game.user.id) return false;
					return game.users.get(flag.ownerId)?.active;
				})
				.map((a) => {
					const flag = a.getFlag("litmv2", "rollDialogOwner");
					const owner = game.users.get(flag.ownerId);
					return {
						actorId: a.id,
						actorName: a.name || t("LITM.Ui.unknown_hero"),
						img: a.img || CONFIG.litmv2.assets.icons.defaultActor,
						openedBy: game.i18n.format("LITM.Ui.opened_by", {
							name: owner?.name || t("LITM.Ui.unknown_user"),
						}),
						clickLabel: t("LITM.Ui.click_to_join_roll"),
					};
				}) || [];

		if (!entries.length) {
			this.#container.innerHTML = "";
			this.#container.classList.add("is-hidden");
			return;
		}

		this.#container.innerHTML = await foundry.applications.handlebars.renderTemplate(
			"systems/litmv2/templates/hud/roll-dialog-hud.html",
			{ entries },
		);
		this.#container.classList.remove("is-hidden");
	}
}
