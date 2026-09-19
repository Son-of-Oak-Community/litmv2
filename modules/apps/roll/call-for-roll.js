import { LitmSettings } from "../../system/settings.js";
import { localize as t } from "../../utils.js";
import { buildRosterEntry } from "../roster.js";
import { resolveFellowshipParticipants } from "./group-roll.js";
import { openSharedRoll } from "./roll-request.js";

/**
 * The Narrator picks who is rolling. That is the whole of this surface.
 *
 * Core Book p.269 makes the Narrator the one who decides an action needs
 * resolving; p.272 has them invoke the opposition's tags. Only the first of
 * those belongs here. The second used to live in a 620x720 app that duplicated
 * the roll dialog's tag picker and shipped a finished configuration to the
 * player — a handoff. It is now a shared table: this picks the seat, the roll
 * dialog opens on both screens, and the Narrator does their invoking there,
 * beside the player doing theirs.
 *
 * So: no tag picking here, no Might, no note. A Hero — or the Fellowship,
 * which is **the last row of the same roster** rather than a mode you switch
 * into. Acting Together (p.157) is one of the things a Narrator can call on,
 * and burying it behind a segmented bar made it read as a setting. Choosing it
 * takes every Hero linked to the Fellowship: the whole group acts, so there is
 * no subset to tick.
 */
export class CallForRollApp extends foundry.applications.api.HandlebarsApplicationMixin(
	foundry.applications.api.ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-call-for-roll",
		classes: ["litm", "litm--roll-call"],
		tag: "div",
		window: {
			title: "LITM.Ui.narrator_call_title",
			icon: "fa-solid fa-feather",
			resizable: false,
		},
		position: { width: 480, height: "auto" },
		actions: {
			callRoll: CallForRollApp.#onCallRoll,
			clearAction: CallForRollApp.#onClearAction,
		},
	};

	static PARTS = {
		form: { template: "systems/litmv2/templates/apps/call-for-roll.html" },
	};

	/**
	 * Open the call. GM-only: this is the Narrator's step. Reuses the single
	 * live instance so a second click focuses the open window.
	 *
	 * @param {object} [options]
	 * @param {string} [options.actionUuid] Pre-link this action item.
	 * @param {string} [options.title]      What the roll is for.
	 * @param {string} [options.type]       Pre-pick the move.
	 * @returns {CallForRollApp|null}
	 */
	static open(options = {}) {
		if (!game.user.isGM) {
			ui.notifications.warn(t("LITM.Actions.gm_only"));
			return null;
		}
		const existing = foundry.applications.instances.get("litm-call-for-roll");
		const app = existing ?? new this();
		app.configure(options);
		app.render(true);
		return app;
	}

	#actionUuid = null;
	#actionDoc = null;
	#title = "";
	#type = "quick";
	/** @type {string|null} The chosen Hero, or the Fellowship's id. */
	#selectedId = null;

	configure({ actionUuid, title, type } = {}) {
		if (actionUuid !== undefined) {
			this.#actionUuid = actionUuid || null;
			this.#actionDoc = null;
		}
		if (title !== undefined) this.#title = title || "";
		if (type !== undefined) this.#type = type || "quick";
	}

	/** Heroes the Narrator can call on, in directory order. */
	get heroes() {
		return game.actors.filter((a) => a.type === "hero");
	}

	/**
	 * The Fellowship, when the table uses one. Acting Together rides this
	 * actor, and where there is none it is simply not offered — no fallback.
	 *
	 * @returns {Actor|null}
	 */
	get fellowship() {
		return LitmSettings.useFellowship
			? (game.litmv2?.fellowship ?? null)
			: null;
	}

	async #resolveAction() {
		if (!this.#actionUuid) {
			this.#actionDoc = null;
			return null;
		}
		if (this.#actionDoc?.uuid === this.#actionUuid) return this.#actionDoc;
		this.#actionDoc = await foundry.utils.fromUuid(this.#actionUuid);
		if (this.#actionDoc?.name && !this.#title)
			this.#title = this.#actionDoc.name;
		return this.#actionDoc;
	}

	async _prepareContext(_options) {
		await this.#resolveAction();
		const fellowship = this.fellowship;
		const heroes = this.heroes;

		// A selection that is no longer on the roster — a Hero deleted, or the
		// Fellowship switched off under a chosen Acting Together — must not
		// survive into the render, or the CTA offers to call on nobody.
		const onRoster =
			heroes.some((h) => h.id === this.#selectedId) ||
			this.#selectedId === fellowship?.id;
		if (this.#selectedId && !onRoster) this.#selectedId = null;

		const targets = heroes.map((hero) =>
			buildRosterEntry(hero, {
				presence: true,
				selected: this.#selectedId === hero.id,
				inputName: "callTarget",
			}),
		);

		if (fellowship)
			targets.push(
				buildRosterEntry(fellowship, {
					selected: this.#selectedId === fellowship.id,
					inputName: "callTarget",
					name: t("LITM.Ui.acting_together"),
					meta: t("LITM.Ui.acting_together_meta"),
					variant: "fellowship",
				}),
			);

		const isGroup = !!fellowship && this.#selectedId === fellowship.id;
		return {
			actionName: this.#actionDoc?.name ?? "",
			actionImg: this.#actionDoc?.img ?? "",
			hasHeroes: heroes.length > 0,
			targets,
			hasSelection: !!this.#selectedId,
			hint: isGroup
				? t("LITM.Ui.acting_together_hint")
				: t("LITM.Ui.narrator_call_who_hint"),
		};
	}

	/**
	 * The roster's inputs are the only event path — see the partial's header
	 * for why. Picking a row selects it; the footer calls the roll. Two steps,
	 * because the Narrator may also want to pick an action for it.
	 */
	_onRender(context, options) {
		super._onRender(context, options);
		this.element
			.querySelector(".litm--roster")
			?.addEventListener("change", (event) => {
				const input = event.target.closest(".litm--roster-input");
				if (!input) return;
				const actorId = input.closest("[data-actor-id]")?.dataset?.actorId;
				if (!actorId || actorId === this.#selectedId) return;
				this.#selectedId = actorId;
				this.render();
			});
	}

	static async #onCallRoll() {
		if (!this.#selectedId) return;
		const fellowship = this.fellowship;
		const isGroup = !!fellowship && this.#selectedId === fellowship.id;

		// Acting Together takes the whole group. Filip's call, reversing the
		// GM-selected subset this used to ask for: when the group acts
		// together, everyone linked to the Fellowship is in it.
		const participantIds = isGroup
			? resolveFellowshipParticipants({
					heroes: this.heroes,
					fellowshipId: fellowship.id,
				})
			: [];
		if (isGroup && !participantIds.length) {
			ui.notifications.warn(t("LITM.Actions.request_no_heroes"));
			return;
		}

		await openSharedRoll({
			actorId: this.#selectedId,
			participantIds,
			actionUuid: this.#actionUuid,
			title: this.#title,
			type: this.#type,
		});
		this.close();
	}

	static #onClearAction() {
		if (!this.#actionUuid) return;
		this.#actionUuid = null;
		this.#actionDoc = null;
		this.#title = "";
		this.render();
	}
}
