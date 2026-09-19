import { LitmSettings } from "../../system/settings.js";
import { localize as t } from "../../utils.js";
import { buildRosterEntry, buildRow } from "../roster.js";
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
 *
 * The one other thing it asks, and only offers: **which Action**. Laid out
 * beside the roster rather than under it, because Foundry gives you width and
 * withholds height — both columns are a fixed height and scroll inside it, so
 * the window a Hero with twenty Actions opens is the window a Hero with none
 * opens. Choosing one is optional throughout; calling without one is the same
 * call this surface has always made.
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
		position: { width: 640, height: "auto" },
		actions: {
			callRoll: CallForRollApp.#onCallRoll,
			clearAction: CallForRollApp.#onClearAction,
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/apps/call-for-roll.html",
			// Picking a row re-renders, and Foundry only restores scroll for
			// selectors listed here. Without them the Heroes list snaps back to
			// the top every time the Narrator picks someone below the fold.
			scrollable: [".litm--roll-call-heroes", "[data-roster='action']"],
		},
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

	/**
	 * The chosen character's Actions, in name order. Read off the Actor rather
	 * than cached: the Narrator may create one in another window mid-call.
	 *
	 * @returns {Item[]}
	 */
	#actionsFor(actor) {
		return (
			actor?.items
				?.filter((it) => it.type === "action")
				.sort((a, b) => a.name.localeCompare(b.name)) ?? []
		);
	}

	/** The category, or the practitioners for a rote — as the browser reads it. */
	#actionMeta(item) {
		if (item.system?.isRote && item.system?.practitioners)
			return item.system.practitioners;
		const category = item.system?.category;
		if (!category) return "";
		if (category === "custom")
			return (
				item.system.customCategory?.trim() ||
				t("LITM.Actions.categories.custom")
			);
		return t(`LITM.Actions.categories.${category}`);
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

		// Pinned below the scrolling Heroes rather than appended to them: at
		// six or seven Heroes the last row is below the fold, and burying
		// Acting Together is the thing this round exists to undo.
		const fellowshipRow = fellowship
			? buildRosterEntry(fellowship, {
					selected: this.#selectedId === fellowship.id,
					inputName: "callTarget",
					name: t("LITM.Ui.acting_together"),
					meta: t("LITM.Ui.acting_together_meta"),
					variant: "fellowship",
				})
			: null;

		const isGroup = !!fellowship && this.#selectedId === fellowship.id;

		// Acting Together has no single character to hang a list off, so the
		// column says why rather than standing empty.
		const selectedHero = isGroup
			? null
			: heroes.find((h) => h.id === this.#selectedId);
		const actions = this.#actionsFor(selectedHero).map((item) =>
			buildRow({
				id: item.id,
				inputName: "callAction",
				selected: item.uuid === this.#actionUuid,
				img: item.img,
				name: item.name,
				meta: this.#actionMeta(item),
				variant: "action",
			}),
		);

		return {
			actionName: this.#actionDoc?.name ?? "",
			actionImg: this.#actionDoc?.img ?? "",
			hasHeroes: heroes.length > 0,
			targets,
			fellowshipRow,
			actions,
			showActions: !!selectedHero,
			actionsHint: isGroup
				? t("LITM.Ui.narrator_call_actions_group")
				: t("LITM.Ui.narrator_call_actions_none"),
			hasSelection: !!this.#selectedId,
			hint: isGroup
				? t("LITM.Ui.acting_together_hint")
				: t("LITM.Ui.narrator_call_who_hint"),
		};
	}

	/**
	 * The rows' inputs are the only event path — see the partial's header for
	 * why. Picking a character selects it; picking an Action links it; the
	 * footer calls the roll. Two steps rather than one, because you cannot
	 * choose an Action for a roll that has already left.
	 */
	_onRender(context, options) {
		super._onRender(context, options);
		for (const list of this.element.querySelectorAll("[data-roster]")) {
			list.addEventListener("change", (event) => {
				const input = event.target.closest(".litm--roster-input");
				if (!input) return;
				const id = input.closest("[data-row-id]")?.dataset?.rowId;
				if (!id) return;
				if (list.dataset.roster === "action") this.#pickAction(id);
				else this.#pickTarget(id);
			});
		}
	}

	#pickTarget(actorId) {
		if (actorId === this.#selectedId) return;
		this.#selectedId = actorId;
		// An Action embedded on *another* character cannot survive a change of
		// roller, so it is dropped. An unowned one — a world or compendium
		// Action, or the `@action` enricher's — has no owner to contradict, and
		// dropping it would destroy the pre-fill the Narrator arrived with,
		// since picking who rolls is the very next thing they do.
		const owner = this.#actionDoc?.parent;
		if (owner instanceof Actor && owner.id !== actorId) {
			this.#actionUuid = null;
			this.#actionDoc = null;
			this.#title = "";
		}
		this.render();
	}

	#pickAction(itemId) {
		const hero = game.actors.get(this.#selectedId);
		const item = hero?.items?.get(itemId);
		if (!item) return;
		this.#actionUuid = item.uuid;
		this.#actionDoc = item;
		this.#title = item.name;
		this.render();
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
