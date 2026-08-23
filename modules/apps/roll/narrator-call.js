import { EFFECT_TAG_ORDER } from "../../system/config.js";
import { renderAction } from "../../system/renderers/action-renderer.js";
import { localize as t } from "../../utils.js";
import { LitmEmbedPopout } from "../embed-popout.js";
import { StoryTagsStore } from "../story-tags/story-tags-store.js";
import { findBurnedSelection, nextStateAfterScratched } from "./burn-cap.js";
import {
	NARRATOR_CALL_TYPES,
	normalizeCallType,
	summarizeNarratorTags,
} from "./narrator-call-rules.js";
import {
	buildActionContext,
	buildGmViewerContext,
	buildSceneStatusItems,
	buildSceneStoryTagItems,
	makeTagDecorator,
	sortByTypeThenName,
} from "./roll-dialog-context.js";
import { sendNarratorCall } from "./roll-request.js";

/**
 * The Narrator's Call — the Narrator's half of a roll, made first.
 *
 * Core Book p.269 puts the choice of outcome method in the Narrator's hands,
 * and p.272 has them invoke the tags of "the target of the action, the
 * opposition, or the environment" (and the Hero's weakness tags, if the
 * player didn't) before the dice come out. This app is that step: pick the
 * move, pick who is rolling, invoke the tags for and against them, judge
 * Might — then hand the roll to the player, who picks their own tags and
 * rolls it.
 *
 * Deliberately duck-types the slice of {@link LitmRollDialog} that
 * `buildGmViewerContext` consumes (`actor`, `actorId`, `getSelection`,
 * `tabGroups`), so the Narrator picks tags through exactly the same grouped,
 * per-actor picker they already get when watching a player's roll — one tag
 * picker in the system, not two.
 */
export class NarratorCallApp extends foundry.applications.api.HandlebarsApplicationMixin(
	foundry.applications.api.ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-narrator-call",
		classes: ["litm", "litm--roll", "litm--narrator-call"],
		tag: "form",
		window: {
			title: "LITM.Ui.narrator_call_title",
			icon: "fa-solid fa-feather",
			resizable: true,
		},
		position: { width: 620, height: 720 },
		form: {
			handler: NarratorCallApp._onSubmit,
			closeOnSubmit: true,
		},
		actions: {
			selectTarget: NarratorCallApp.#onSelectTarget,
			toggleRollTag: NarratorCallApp.#onToggleRollTag,
			viewActionCard: NarratorCallApp.#onViewActionCard,
			clearAction: NarratorCallApp.#onClearAction,
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/apps/narrator-call.html",
			scrollable: [
				".litm--roll-dialog-tags-fieldset",
				".litm--roll-dialog-tags-fieldset section.tab",
			],
		},
	};

	/**
	 * Open the call. GM-only: the whole point is that this is the Narrator's
	 * step. Reuses the single live instance so a second click focuses the open
	 * window instead of stacking another.
	 *
	 * @param {object} [options]
	 * @param {string} [options.actorId]    Pre-target this hero.
	 * @param {string} [options.actionUuid] Pre-link this action item.
	 * @param {string} [options.title]      Pre-fill what the roll is for.
	 * @param {string} [options.type]       Pre-pick the move.
	 * @returns {NarratorCallApp|null}
	 */
	static open(options = {}) {
		if (!game.user.isGM) {
			ui.notifications.warn(t("LITM.Actions.gm_only"));
			return null;
		}
		const existing = foundry.applications.instances.get("litm-narrator-call");
		const app = existing ?? new this();
		app.configureCall(options);
		app.render(true);
		return app;
	}

	#type = "quick";
	#targetId = null;
	#note = "";
	#might = 0;
	#actionUuid = null;
	#actionDoc = null;
	/** @type {Map<string, {state: string, effectUuid: string}>} */
	#selectionMap = new Map();

	/**
	 * Apply pre-fill options to an open or fresh call. Selections are cleared
	 * whenever the target changes — an invocation against one Hero rarely
	 * means the same thing against another, and silently carrying it over
	 * would be a Power error nobody sees.
	 */
	configureCall({ actorId, actionUuid, title, type } = {}) {
		if (type) this.#type = normalizeCallType(type);
		if (actionUuid !== undefined) {
			this.#actionUuid = actionUuid || null;
			this.#actionDoc = null;
		}
		if (title !== undefined) this.rollName = title || "";
		const nextTarget = actorId ?? this.#targetId ?? this.#defaultTargetId();
		if (nextTarget !== this.#targetId) {
			this.#targetId = nextTarget;
			this.#selectionMap.clear();
		}
	}

	rollName = "";

	/** Heroes the Narrator can call on, in sheet order. */
	get heroes() {
		return game.actors.filter((a) => a.type === "hero");
	}

	/**
	 * Whom to target when the Narrator hasn't said: the Hero behind their
	 * current canvas target if there is one (the Narrator has usually already
	 * pointed at whoever is acting), otherwise the first Hero in the world.
	 */
	#defaultTargetId() {
		for (const token of game.user.targets ?? []) {
			if (token.actor?.type === "hero") return token.actor.id;
		}
		return this.heroes[0]?.id ?? null;
	}

	/* ---- LitmRollDialog-shaped surface consumed by buildGmViewerContext ---- */

	get actorId() {
		return this.#targetId;
	}

	get actor() {
		return this.#targetId ? game.actors.get(this.#targetId) : null;
	}

	get selections() {
		return this.#selectionMap;
	}

	getSelection(uuid) {
		return this.#selectionMap.get(uuid) ?? { state: "", contributorId: null };
	}

	setSelection(uuid, state) {
		if (!state) this.#selectionMap.delete(uuid);
		else this.#selectionMap.set(uuid, { state, effectUuid: uuid });
	}

	/* ----------------------------- rendering ----------------------------- */

	async #resolveAction() {
		if (!this.#actionUuid) {
			this.#actionDoc = null;
			return null;
		}
		if (this.#actionDoc?.uuid === this.#actionUuid) return this.#actionDoc;
		this.#actionDoc = await foundry.utils.fromUuid(this.#actionUuid);
		if (this.#actionDoc?.name && !this.rollName)
			this.rollName = this.#actionDoc.name;
		return this.#actionDoc;
	}

	async _prepareContext(_options) {
		await StoryTagsStore.loadStoryTags();
		await this.#resolveAction();
		if (!this.#targetId) this.#targetId = this.#defaultTargetId();

		const decorateTag = makeTagDecorator({ isOwner: true });
		const getSelection = (uuid) => this.getSelection(uuid);
		const sceneStoryItems = [
			...sortByTypeThenName(
				buildSceneStatusItems(getSelection).map(decorateTag),
				EFFECT_TAG_ORDER,
			),
			...sortByTypeThenName(
				buildSceneStoryTagItems(getSelection).map(decorateTag),
				EFFECT_TAG_ORDER,
			),
		];

		// Same per-actor tab set the Narrator sees while watching a player's
		// roll — the target Hero first, then the Story tab (scene tags plus
		// every Challenge / Journey / Story Theme), then the rest of the table.
		const tabs = this.actor
			? buildGmViewerContext(this, {
					decorateTag,
					tagTypeOrder: EFFECT_TAG_ORDER,
					allStoryItems: sceneStoryItems,
					sceneStoryItems,
					isOwner: true,
				})
			: [];

		const invoked = this.#invokedTags();

		return {
			type: this.#type,
			rollTypes: NARRATOR_CALL_TYPES.map((key) => ({
				key,
				label: t(`LITM.Ui.roll_${key}`),
				hint: t(`LITM.Ui.narrator_call_hint_${key}`),
				active: key === this.#type,
			})),
			title: this.rollName,
			note: this.#note,
			might: this.#might,
			mightRange: Array.from({ length: 13 }, (_, i) => i - 6),
			targets: this.heroes.map((hero) => this.#targetContext(hero)),
			hasTargets: this.heroes.length > 0,
			target: this.actor ? this.#targetContext(this.actor) : null,
			tabs,
			hasTags: tabs.some((tab) => tab.groups?.length),
			invoked,
			hasInvoked: invoked.helpful.length + invoked.hindering.length > 0,
			actionContext: buildActionContext({ action: this.#actionDoc }),
		};
	}

	/** Per-hero row for the target picker: who plays them, and are they here. */
	#targetContext(hero) {
		const owners = game.users.filter(
			(u) => !u.isGM && hero.testUserPermission(u, "OWNER"),
		);
		const online = owners.filter((u) => u.active);
		return {
			id: hero.id,
			name: hero.name,
			img: hero.prototypeToken?.texture?.src || hero.img,
			selected: hero.id === this.#targetId,
			playerName: owners.map((u) => u.name).join(", "),
			online: online.length > 0,
			statusLabel: online.length
				? online.map((u) => u.name).join(", ")
				: owners.length
					? t("LITM.Ui.narrator_call_player_offline")
					: t("LITM.Ui.narrator_call_no_player"),
		};
	}

	/** The Narrator's current invocations, resolved to names for the summary. */
	#invokedTags() {
		const tags = [];
		for (const [uuid, sel] of this.#selectionMap) {
			if (!sel.state) continue;
			const effect = foundry.utils.fromUuidSync(uuid);
			if (!effect) continue;
			tags.push({
				name: effect.name,
				type: effect.type,
				value: effect.system?.currentTier ?? 0,
				state: sel.state,
			});
		}
		return summarizeNarratorTags(tags);
	}

	_onFirstRender(context, options) {
		super._onFirstRender(context, options);
		this.element.addEventListener("change", (event) => {
			const target = event.target;
			if (target.tagName === "LITM-SUPER-CHECKBOX") this.#onTagChange(target);
			else if (target.matches("input[name='type']")) this.#onTypeChange(target);
			else if (target.matches("input[name='might']"))
				this.#onMightChange(target);
			else if (target.matches("[name='note']")) this.#note = target.value ?? "";
			else if (target.matches("[name='title']"))
				this.rollName = target.value ?? "";
		});
	}

	/* ------------------------------ handlers ------------------------------ */

	static #onSelectTarget(_event, target) {
		const actorId = target?.dataset?.actorId;
		if (!actorId || actorId === this.#targetId) return;
		this.#targetId = actorId;
		// A new Hero means a new situation: the invocations were judged against
		// the previous target and don't transfer.
		this.#selectionMap.clear();
		this.render();
	}

	/**
	 * Mirrors the roll dialog's tag row: clicking the label cycles the
	 * super-checkbox, shift-clicking jumps straight to (or out of) a burn.
	 */
	static #onToggleRollTag(event, target) {
		if (event.target.tagName === "LITM-SUPER-CHECKBOX") return;
		event.preventDefault();
		const checkbox = target.querySelector("litm-super-checkbox");
		if (!checkbox || checkbox.disabled) return;

		if (event.shiftKey) {
			const canScratch = checkbox.getAttribute("states")?.includes("scratched");
			if (canScratch) {
				const burning = checkbox.value !== "scratched";
				if (burning && findBurnedSelection(this.#selectionMap, checkbox.name)) {
					ui.notifications?.warn(t("LITM.Ui.burn_cap_warning"));
					return;
				}
				checkbox.value = burning ? "scratched" : "";
				checkbox.dispatchEvent(new Event("change", { bubbles: true }));
				return;
			}
		}
		checkbox.click();
	}

	#onTagChange(target) {
		const { name: uuid, value } = target;
		// Burn cap (p.158): one burned tag per roll, Narrator included. Skip
		// past the blocked waypoint rather than trapping the cycle.
		if (
			value === "scratched" &&
			findBurnedSelection(this.#selectionMap, uuid)
		) {
			ui.notifications?.warn(t("LITM.Ui.burn_cap_warning"));
			const states = (target.getAttribute("states") ?? "").split(",");
			const next = nextStateAfterScratched(states);
			target.value = next || "";
			this.setSelection(uuid, next);
		} else {
			this.setSelection(uuid, value);
		}
		this.#renderInvokedSummary();
	}

	#onTypeChange(target) {
		this.#type = normalizeCallType(target.value);
		const bar = target.closest(".litm--roll-type-bar");
		for (const label of bar?.children ?? []) {
			const radio = label.querySelector("input[type='radio']");
			if (radio)
				label.classList.toggle("is-active", radio.value === this.#type);
		}
	}

	#onMightChange(target) {
		this.#might = Number(target.value) || 0;
		for (const label of this.element.querySelectorAll(".litm--might-option")) {
			const radio = label.querySelector("input[type='radio']");
			label.classList.toggle("is-active", radio?.value === String(this.#might));
		}
	}

	/** Repaint just the invocation summary — a full render would blur the
	 *  note field the Narrator is very likely mid-sentence in. */
	#renderInvokedSummary() {
		const host = this.element?.querySelector("[data-update='invoked']");
		if (!host) return;
		const { helpful, hindering } = this.#invokedTags();
		const chip = (tag) =>
			`<span class="litm-${tag.type}" data-text="${foundry.utils.escapeHTML(tag.name)}">${foundry.utils.escapeHTML(tag.name)}</span>`;
		const line = (label, tags) =>
			tags.length
				? `<p class="litm--narrator-call-invoked-line"><span class="litm--narrator-call-invoked-label">${label}</span>${tags.map(chip).join(" ")}</p>`
				: "";
		host.innerHTML =
			line(t("LITM.Ui.narrator_call_helping"), helpful) +
			line(t("LITM.Ui.narrator_call_hindering"), hindering);
	}

	static async #onViewActionCard() {
		if (!this.#actionDoc) return;
		new LitmEmbedPopout({
			document: this.#actionDoc,
			render: renderAction,
		}).render(true);
	}

	static #onClearAction() {
		if (!this.#actionUuid) return;
		this.#actionUuid = null;
		this.#actionDoc = null;
		this.rollName = "";
		this.render();
	}

	static async _onSubmit(_event, _form, formData) {
		const data = foundry.utils.expandObject(formData.object);
		if (!this.#targetId) {
			ui.notifications.warn(t("LITM.Actions.request_no_heroes"));
			return;
		}
		await sendNarratorCall({
			actorId: this.#targetId,
			type: normalizeCallType(data.type ?? this.#type),
			title: (data.title ?? this.rollName ?? "").trim(),
			note: (data.note ?? this.#note ?? "").trim(),
			might: Number(data.might ?? this.#might) || 0,
			actionUuid: this.#actionUuid,
			selections: this.#selectionMap,
		});
	}
}
