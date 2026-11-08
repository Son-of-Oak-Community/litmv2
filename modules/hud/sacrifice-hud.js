import {
	completePendingSacrifice,
	pendingSacrifice,
} from "../apps/roll/sacrifice-price.js";
import { effectiveSacrificeLevel } from "../apps/roll/sacrifice-rules.js";
import { localize as t } from "../utils.js";
import { mountPlayersHud } from "./players-hud.js";

/**
 * The price a Hero's owed Sacrifice will actually take, once a Miracle has
 * lessened it: the level, then the theme (Painful/Scarring) or the status
 * (Grave). The theme is left out when it is already gone.
 * @param {Actor} actor
 * @param {object} pending  The Hero's pendingSacrifice flag.
 * @returns {string}
 */
export function debtPrice(actor, pending) {
	const effective = effectiveSacrificeLevel(pending.level, pending.outcome);
	// A lessened Painful still scratches from the same theme; it reads as Painful.
	const level = t(
		`LITM.Ui.sacrifice_${effective === "painfulOne" ? "painful" : effective}`,
	);
	const subject =
		effective === "grave"
			? (pending.statusName || "").trim() ||
				t("LITM.Ui.sacrifice_grave_default")
			: (actor.items.get(pending.themeId)?.name ?? "");
	return subject ? `${level} — ${subject}` : level;
}

/**
 * The ribbon for unpaid Sacrifices (Core Book p.159): one entry per Hero who
 * still owes a price, above the player list where the whole table sees it.
 * The debt lives on the Hero, so this outlasts the chat card. Like the other
 * strips, an entry opens something rather than acting: for the Hero's owners,
 * the payment dialog, where the Narrator may also forgive it.
 */
export class SacrificeHud {
	#container = null;
	/** Bumped per render, so a slower earlier render can't overwrite a newer one. */
	#generation = 0;

	async render() {
		const generation = ++this.#generation;
		if (!document.getElementById("players")) return;

		if (!this.#container) {
			this.#container = document.createElement("div");
			this.#container.id = "litm-sacrifice-hud";
			this.#container.classList.add(
				"litm-roll-dialog-hud",
				"litm-sacrifice-hud",
				"is-hidden",
			);
			this.#container.addEventListener("click", (event) => {
				const target = event.target.closest("button[data-actor-id]");
				const actor = game.actors.get(target?.dataset.actorId);
				if (actor) completePendingSacrifice(actor);
			});
		}
		mountPlayersHud(this.#container);

		const entries =
			game.actors
				?.filter((a) => pendingSacrifice(a))
				.map((actor) => {
					return {
						actorId: actor.id,
						img: actor.img || CONFIG.litmv2.assets.icons.defaultActor,
						owes: game.i18n.format("LITM.Ui.sacrifice_debt_owes", {
							name: actor.name,
							price: debtPrice(actor, pendingSacrifice(actor)),
						}),
						canPay: actor.isOwner,
					};
				}) ?? [];

		if (!entries.length) {
			this.#container.innerHTML = "";
			this.#container.classList.add("is-hidden");
			return;
		}
		const html = await foundry.applications.handlebars.renderTemplate(
			"systems/litmv2/templates/hud/sacrifice-hud.html",
			{ entries },
		);
		if (generation !== this.#generation) return;
		this.#container.innerHTML = html;
		this.#container.classList.remove("is-hidden");
	}
}
