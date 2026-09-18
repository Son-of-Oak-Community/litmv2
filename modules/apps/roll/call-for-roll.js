import { LitmSettings } from "../../system/settings.js";
import { localize as t } from "../../utils.js";
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
 * So: no tag picking here, no Might, no note. A hero, or the Fellowship when
 * the table uses one — Acting Together (p.157) is a single roll for the group,
 * and the Fellowship actor is the thing that rolls it.
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
			callTarget: CallForRollApp.#onCallTarget,
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
		// No Fellowship, no Acting Together — there is nothing for the group
		// roll to ride, and the brief is explicit that there is no fallback.
		const fellowship = LitmSettings.useFellowship
			? game.litmv2?.fellowship
			: null;
		return {
			actionName: this.#actionDoc?.name ?? "",
			actionImg: this.#actionDoc?.img ?? "",
			hasHeroes: this.heroes.length > 0,
			targets: this.heroes.map((hero) => this.#targetContext(hero)),
			fellowship: fellowship
				? {
						id: fellowship.id,
						name: fellowship.name,
						img: fellowship.img,
						label: t("LITM.Ui.acting_together"),
					}
				: null,
		};
	}

	/** Per-hero plaque: who plays them, and are they here. */
	#targetContext(hero) {
		const owners = game.users.filter(
			(u) => !u.isGM && hero.testUserPermission(u, "OWNER"),
		);
		const online = owners.filter((u) => u.active);
		return {
			id: hero.id,
			name: hero.name,
			img: hero.prototypeToken?.texture?.src || hero.img,
			online: online.length > 0,
			statusLabel: online.length
				? online.map((u) => u.name).join(", ")
				: owners.length
					? t("LITM.Ui.narrator_call_player_offline")
					: t("LITM.Ui.narrator_call_no_player"),
		};
	}

	static async #onCallTarget(_event, target) {
		const actorId = target?.dataset?.actorId;
		if (!actorId) return;
		await openSharedRoll({
			actorId,
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
