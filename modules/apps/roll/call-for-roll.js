import { LitmSettings } from "../../system/settings.js";
import { localize as t } from "../../utils.js";
import { resolveGroupParticipants } from "./group-roll.js";
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
			pickTarget: CallForRollApp.#onPickTarget,
			setMode: CallForRollApp.#onSetMode,
			callGroup: CallForRollApp.#onCallGroup,
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
	/** @type {Set<string>} Heroes ticked for an Acting Together roll. */
	#participants = new Set();
	/** @type {"solo"|"group"} */
	#mode = "solo";

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
		// No Fellowship, no Acting Together — there is nothing for the group roll
		// to ride, so the mode bar doesn't appear and `solo` is the only shape.
		const fellowship = LitmSettings.useFellowship
			? game.litmv2?.fellowship
			: null;
		const isGroup = !!fellowship && this.#mode === "group";
		const targets = this.heroes.map((hero) => ({
			...this.#targetContext(hero),
			selected: isGroup && this.#participants.has(hero.id),
		}));
		return {
			actionName: this.#actionDoc?.name ?? "",
			actionImg: this.#actionDoc?.img ?? "",
			hasHeroes: targets.length > 0,
			targets,
			hasFellowship: !!fellowship,
			isGroup,
			modes: [
				{ id: "solo", label: t("LITM.Ui.narrator_call_who"), active: !isGroup },
				{ id: "group", label: t("LITM.Ui.acting_together"), active: isGroup },
			],
			hint: isGroup
				? t("LITM.Ui.acting_together_hint")
				: t("LITM.Ui.narrator_call_who_hint"),
			canOpenGroup: this.#participants.size > 0,
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

	/**
	 * One plaque, two meanings: in solo mode it *is* the call, so the roll
	 * window opens on the spot; in Acting Together mode it ticks a participant
	 * and the roll opens from the button below.
	 */
	static async #onPickTarget(_event, target) {
		const actorId = target?.dataset?.actorId;
		if (!actorId) return;
		if (this.#mode === "group" && LitmSettings.useFellowship) {
			if (this.#participants.has(actorId)) this.#participants.delete(actorId);
			else this.#participants.add(actorId);
			this.render();
			return;
		}
		await openSharedRoll({
			actorId,
			actionUuid: this.#actionUuid,
			title: this.#title,
			type: this.#type,
		});
		this.close();
	}

	static #onSetMode(_event, target) {
		const mode = target?.dataset?.mode;
		if (!mode || mode === this.#mode) return;
		this.#mode = mode;
		this.render();
	}

	static async #onCallGroup() {
		const fellowship = LitmSettings.useFellowship
			? game.litmv2?.fellowship
			: null;
		if (!fellowship) return;
		const participantIds = resolveGroupParticipants({
			heroes: this.heroes,
			selectedIds: [...this.#participants],
		});
		if (!participantIds.length) return;
		await openSharedRoll({
			actorId: fellowship.id,
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
