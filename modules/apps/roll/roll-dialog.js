import {
	effectToPlain,
	resolveTagActorId,
} from "../../active-effects/effect-queries.js";
import { maxStatusTier } from "../../active-effects/status-tag-data.js";
import { ALL_TAG_TYPES, EFFECT_TAG_ORDER, FLAGS } from "../../system/config.js";
import { renderAction } from "../../system/renderers/action-renderer.js";
import { LitmSettings } from "../../system/settings.js";
import { Sockets } from "../../system/sockets.js";
import {
	getStoryTagSidebar,
	localize as t,
	viewLinkedRefAction,
} from "../../utils.js";
import { LitmEmbedPopout } from "../embed-popout.js";
import { mitigationBannerText } from "../mitigation.js";
import { StoryTagsStore } from "../story-tags/story-tags-store.js";
import { findBurnedSelection, nextStateAfterScratched } from "./burn-cap.js";
import { findHeroTagConflict } from "./group-roll.js";
import { LitmRoll } from "./roll.js";
import {
	canEditNarratorFields,
	canEditTradePower,
	isNarratorControlled,
	requiresRollApproval,
	showsRollSettings,
} from "./roll-authority.js";
import {
	buildActionContext,
	buildAllyTagGroups,
	buildContributedTagGroups,
	buildGmViewerContext,
	buildGroupRollTabs,
	buildOwnerContext,
	buildSceneActorTagGroups,
	buildSceneStatusItems,
	buildSceneStoryTagItems,
	makeTagDecorator,
	actableActorIds,
	sortByTypeThenName,
} from "./roll-dialog-context.js";
import {
	buildRollPreview,
	executeRoll,
	resolveRollDialogOwnership,
} from "./roll-pipeline.js";
import { hasPainfulSacrificeTarget, isThemeSpent } from "./sacrifice-rules.js";

export { resolveRollDialogOwnership };

export class LitmRollDialog extends foundry.applications.api.HandlebarsApplicationMixin(
	foundry.applications.api.ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-roll-dialog",
		classes: ["litm", "litm--roll"],
		tag: "form",
		window: {
			title: "LITM.Ui.roll_title",
			resizable: true,
		},
		position: {
			width: 600,
			height: 720,
		},
		form: {
			handler: LitmRollDialog._onSubmit,
			closeOnSubmit: true,
		},
		actions: {
			sendToNarrator: LitmRollDialog.#onSendToNarrator,
			"spend-half": LitmRollDialog.#onSpendHalf,
			viewLinkedRef: viewLinkedRefAction,
			viewActionCard: LitmRollDialog.#onViewActionCard,
			clearAction: LitmRollDialog.#onClearAction,
			toggleRollTag: LitmRollDialog.#onToggleRollTag,
			selectSacrificeTheme: LitmRollDialog.#onSelectSacrificeTheme,
			setSacrificeLevel: LitmRollDialog.#onSetSacrificeLevel,
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/apps/roll-dialog.html",
			scrollable: [
				".litm--roll-dialog-tags-fieldset",
				".litm--roll-dialog-tags-fieldset section.tab",
			],
		},
	};

	static create(options) {
		return new LitmRollDialog(options);
	}

	/** Delegates to {@link executeRoll} for the actual roll pipeline. Kept
	 *  as a static for socket dispatch and preserved external callers. */
	static roll(data) {
		return executeRoll(data);
	}

	static async _onSubmit(_event, _form, formData) {
		if (!this.isOwner) return;
		if (this.painfulSacrificeHasNoTarget()) return;
		const rollData = this.extractRollData(formData);
		// Tables that want the Narrator to have the last word on a total route
		// every player roll through the moderation card they already had as an
		// opt-in button. Same hardened path: approval reads the roll back off
		// the ChatMessage the roller authored rather than trusting a socket.
		if (this.requiresApproval) {
			await this._createModerationRequest(rollData);
			ui.notifications?.info(t("LITM.Ui.roll_sent_for_approval"));
			return;
		}
		return executeRoll(rollData);
	}

	static async #onSendToNarrator(_event, _target) {
		if (!this.isOwner) return;
		if (this.painfulSacrificeHasNoTarget()) return;
		const formData = new foundry.applications.ux.FormDataExtended(this.element);
		const rollData = this.extractRollData(formData);
		await this._createModerationRequest(rollData);
		this.close();
	}

	/**
	 * Guard against a Painful sacrifice that can't pay its price. Painful
	 * scratches a theme's power tags, so it needs a theme with something left to
	 * scratch; when every theme is already spent the sacrifice would cost
	 * nothing. Warns and nudges the player to a higher tier instead of rolling a
	 * free Miracle. Returns true (and warns) when the roll should be blocked.
	 * Public — called from the static submit/narrator handlers, same as
	 * {@link extractRollData}.
	 * @returns {boolean}
	 */
	painfulSacrificeHasNoTarget() {
		if (this.type !== "sacrifice" || this.#sacrificeLevel !== "painful")
			return false;
		const themes = this.#sacrificeThemeItems();
		if (themes.length === 0 || hasPainfulSacrificeTarget(themes)) return false;
		ui.notifications?.warn(t("LITM.Ui.sacrifice_all_spent_warning"));
		return true;
	}

	static #onSetSacrificeLevel(_event, target) {
		if (!this.isOwner) return;
		const level = target?.dataset?.level;
		if (!level || level === this.#sacrificeLevel) return;
		this.#sacrificeLevel = level;
		this.#applySacrificeLevelToDom(level);
		this.#toggleSacrificeSubfields(this.#sacrificeLevel);
		this.#dispatchUpdate();
	}

	/** Reflect the active sacrifice level in the rendered grid: highlight the
	 *  level chip, mark the theme grid (.painful-mode disables spent cards via
	 *  CSS), and bump the selection off a now-invalid spent theme. Level
	 *  changes don't re-render, so this runs by hand; shared by the click and
	 *  keyboard level handlers. */
	#applySacrificeLevelToDom(level) {
		const root = this.element;
		if (!root) return;
		for (const label of root.querySelectorAll(
			"[data-action='setSacrificeLevel']",
		)) {
			label.classList.toggle("is-active", label.dataset.level === level);
		}
		const isPainful = level === "painful";
		const grid = root.querySelector(".litm--sacrifice-theme-grid");
		grid?.classList.toggle("painful-mode", isPainful);
		if (!isPainful) return;
		const cards = [
			...root.querySelectorAll("[data-action='selectSacrificeTheme']"),
		];
		const selected = cards.find(
			(c) => c.dataset.themeId === this.#sacrificeThemeId,
		);
		if (selected?.dataset.spent === "true") {
			const live = cards.find((c) => c.dataset.spent !== "true");
			if (live) this.#applySacrificeThemeSelection(live.dataset.themeId);
		}
	}

	static #onSelectSacrificeTheme(_event, target) {
		if (!this.isOwner) return;
		const themeId = target?.dataset?.themeId;
		if (!themeId || themeId === this.#sacrificeThemeId) return;
		// A spent theme is not a valid Painful target — nothing left to scratch.
		if (this.#sacrificeLevel === "painful" && target.dataset.spent === "true")
			return;
		this.#applySacrificeThemeSelection(themeId);
		this.#dispatchUpdate();
	}

	/** Set the sacrifice theme (the private field is the source of truth, same
	 *  principle as #selectionMap) and reflect it in the rendered card grid.
	 *  Shared by the click handler and the level switch (which may need to bump
	 *  selection off a spent theme). */
	#applySacrificeThemeSelection(themeId) {
		this.#sacrificeThemeId = themeId;
		const root = this.element;
		if (!root) return;
		for (const card of root.querySelectorAll(
			"[data-action='selectSacrificeTheme']",
		)) {
			const isSelected = card.dataset.themeId === themeId;
			card.classList.toggle("is-selected", isSelected);
			card.setAttribute("aria-checked", isSelected ? "true" : "false");
		}
	}

	static async #onSpendHalf(_event, _target) {
		const power = this.totalPower;
		if (power < 1) {
			ui.notifications?.warn(t("LITM.Ui.camping_spend_half_no_power"));
			return;
		}
		const half = Math.ceil(power / 2);
		const actor = this.actor;
		if (!actor) return;
		await this.close();
		const { SpendPowerApp } = await import("../spend-power.js");
		new SpendPowerApp({ actorId: actor.id, power: half }).render(true);
	}

	/** Open the linked action's read-only embed card in a popout — the action
	 *  sheet is an editor, not a reference view. */
	static async #onViewActionCard() {
		const doc = this.actionDoc;
		if (!doc) return;
		new LitmEmbedPopout({
			document: doc,
			render: renderAction,
		}).render(true);
	}

	/** Detach the linked action from this dialog without rolling. Lets the
	 *  player back out of an action they opened by mistake, or downgrade to a
	 *  plain roll without closing the window and losing their tag selections. */
	static #onClearAction() {
		if (!this.actionUuid) return;
		this.setAction(null);
		this.rollName = "";
	}

	/**
	 * Click on a tag's label cycles the embedded super-checkbox; shift-click
	 * jumps straight to (or out of) the "scratched" state when the tag allows
	 * it. The early return covers re-entry: the programmatic checkbox.click()
	 * below bubbles a fresh click event back through the same data-action.
	 */
	static #onToggleRollTag(event, target) {
		if (event.target.tagName === "LITM-SUPER-CHECKBOX") return;
		event.preventDefault();
		const checkbox = target.querySelector("litm-super-checkbox");
		if (!checkbox) return;

		if (event.shiftKey && !checkbox.disabled) {
			const canScratch = checkbox.getAttribute("states")?.includes("scratched");
			if (canScratch) {
				const burning = checkbox.value !== "scratched";
				// Burn cap (p.158): an explicit shift-to-burn is refused outright
				// when another tag is already burned, leaving this tag untouched.
				// (The natural cycle skips past instead — see `_onTagChange`.)
				if (burning && findBurnedSelection(this.#selectionMap, checkbox.name)) {
					ui.notifications?.warn(t("LITM.Ui.burn_cap_warning"));
					return;
				}
				checkbox.value = burning ? "scratched" : "";
				// Bubble so the delegated `_onTagChange` registers the selection
				// (and applies the non-owner permission gate) — a non-bubbling
				// event would set only the visual and never reach the handler.
				checkbox.dispatchEvent(new Event("change", { bubbles: true }));
				return;
			}
		}
		checkbox.click();
	}

	/**
	 * The roll to execute, read from the dialog's own state rather than from
	 * the form.
	 *
	 * `FormDataExtended` skips `:disabled` controls, and this dialog
	 * deliberately disables the Might and the move for a roller on a called
	 * roll — so reading them off the form would silently drop exactly the
	 * values the Narrator had just set: the dialog would show Power 3 and the
	 * card roll 0. The same trapdoor swallows `modifier` and `title`, which
	 * have no form control at all, so a sojourn bonus never reached the dice.
	 *
	 * The private fields are the single source of truth — the same principle
	 * `#selectionMap` and the sacrifice fields already follow — and they are
	 * kept current by the change handlers and by `receiveUpdate`. Nothing that
	 * contributes to Power is read from the DOM, which is what makes "the
	 * dialog total equals the chat-card total" hold by construction.
	 */
	extractRollData(_formData) {
		// Sacrifice hides the type radio bar entirely, so the dialog's tracked
		// type is the only self-describing answer in that mode.
		const type = this.type || "quick";
		const tags = this.#buildTagsFromMap();
		const isSacrifice = type === "sacrifice";
		return {
			actorId: this.actorId,
			type,
			tags,
			title: this.rollName,
			speaker: this.speaker,
			// Mirrors the `totalPower` getter, which is what the dialog displays.
			modifier: this.#modifier + this.#sojournBonus,
			might: this.#might,
			tradePower: this.#tradePower,
			sacrificeLevel: isSacrifice ? this.#sacrificeLevel : undefined,
			sacrificeThemeId: isSacrifice ? this.#sacrificeThemeId : undefined,
			sacrificeStatusName:
				isSacrifice && this.#sacrificeLevel === "grave"
					? this.#sacrificeStatusName
					: undefined,
			actionUuid: this.#actionUuid,
			mitigation: type === "mitigate" ? this.#mitigation : null,
			// Acting Together: the outcome lands on the whole group (p.157), so
			// the card carries who was in it and the GM's apply flow offers them
			// as targets. Applying to each of them is still a decision, not an
			// automatic fan-out.
			participantIds: this.isGroupRoll ? [...this.#participantIds] : [],
		};
	}

	get title() {
		const base = game.i18n.localize("LITM.Ui.roll_title");
		const name = this.actor?.name;
		return name ? `${name} — ${base}` : base;
	}

	/**
	 * @typedef {object} SelectionEntry
	 * @property {string} state - "positive"|"negative"|"scratched"|""
	 * @property {string|null} contributorId - user ID who selected this tag
	 * @property {ActiveEffect|null} effect - resolved AE reference (null until resolved)
	 * @property {string|null} effectUuid - AE UUID for cross-client resolution
	 * @property {string|null} [contributorActorId] - actor ID of the contributing character
	 * @property {string|null} [contributorActorName] - display name of the contributing character
	 * @property {string|null} [contributorActorImg] - image of the contributing character
	 */

	/** @type {Map<string, SelectionEntry>} */
	#selectionMap = new Map();

	#modifier = 0;
	#might = 0;
	#tradePower = 0;
	#sacrificeLevel = "painful";
	#sacrificeThemeId = null;
	#sacrificeStatusName = "";
	#ownerId = null;
	#cachedTotalPower = null;
	#actionUuid = null;
	#actionDoc = null;
	#sojournBonus = 0;
	#mitigation = null;
	/**
	 * The Narrator's stamp on this roll. Set when the Narrator opens a shared
	 * roll and nulled by {@link reset}. Its presence — not the GM's mere
	 * presence in the room — is what moves the move type and the Might out of
	 * the roller's reach (see `roll-authority.js`).
	 * @type {{narratorUserId: string, narratorName: string}|null}
	 */
	#narratorCall = null;
	/**
	 * Heroes taking part in an Acting Together roll (Core Book p.157). Empty
	 * on every ordinary roll.
	 * @type {string[]}
	 */
	#participantIds = [];

	constructor(options = {}) {
		if (options.actorId) options.id = `litm-roll-dialog-${options.actorId}`;
		super(options);

		this.#modifier = options.modifier || 0;
		this.#might = Number(options.might) || 0;
		this.#tradePower = options.tradePower || 0;
		this.#sacrificeLevel = options.sacrificeLevel || "painful";
		this.#sacrificeThemeId = options.sacrificeThemeId || null;
		this.#sacrificeStatusName = options.sacrificeStatusName || "";
		this.#ownerId = options.ownerId || null;
		this.#actionUuid = options.actionUuid || null;

		this.actorId = options.actorId;
		this.speaker =
			options.speaker ||
			foundry.documents.ChatMessage.getSpeaker({ actor: this.actor });
		this.rollName = options.title || "";
		this.type = options.type || "quick";
	}

	/**
	 * Resolve the linked action document if not already cached. Async-safe;
	 * supports compendium UUIDs that aren't preloaded.
	 * @returns {Promise<Item|null>}
	 */
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

	get actionUuid() {
		return this.#actionUuid;
	}

	get actionDoc() {
		return this.#actionDoc;
	}

	setAction(uuid) {
		this.#actionUuid = uuid || null;
		this.#actionDoc = null;
		// Action rolls and sacrifice are mutually exclusive — rolling an
		// action while the dialog is parked in sacrifice mode must drop
		// sacrifice, mirroring the Roll button's behaviour in hero-sheet.
		if (this.#actionUuid && this.type === "sacrifice") {
			this.type = "quick";
			this.updatePresence(true);
		}
		if (this.rendered) this.render();
	}

	/**
	 * Attach (or clear) the consequence being reacted to. Drives the mitigate
	 * dialog banner and is persisted on the resulting roll so the Spend Power
	 * menu can pre-target the inflicted status/tag. Net-new dialog state.
	 */
	setMitigation(context) {
		this.#mitigation = context || null;
		if (this.rendered) this.render();
	}

	/** @returns {{narratorUserId: string, narratorName: string}|null} */
	get narratorCall() {
		return this.#narratorCall;
	}

	/** @returns {string[]} Heroes taking part in an Acting Together roll. */
	get participantIds() {
		return [...this.#participantIds];
	}

	/**
	 * An Acting Together roll (Core Book p.157) rides the Fellowship actor —
	 * one roll for the whole group, so the Fellowship is the thing that rolls.
	 * Where there is no Fellowship, Acting Together is simply not a thing.
	 * @returns {boolean}
	 */
	get isGroupRoll() {
		const fellowshipId = game.litmv2?.fellowship?.id;
		return !!fellowshipId && this.actorId === fellowshipId;
	}

	/**
	 * Whether this client may set the move type and the Might — the Narrator's
	 * half of a called roll. Narrator invocations already outrank dialog
	 * ownership for tags (`#canModifyTag`); this is the same rule for the other
	 * two things the Narrator judges.
	 * @returns {boolean}
	 */
	get canSetNarratorFields() {
		return canEditNarratorFields({
			isGM: game.user.isGM,
			isOwner: this.isOwner,
			narratorControlled: isNarratorControlled(this.#narratorCall),
		});
	}

	/**
	 * Whether pressing Roll asks the Narrator rather than rolling.
	 * @returns {boolean}
	 */
	get requiresApproval() {
		return requiresRollApproval({
			isGM: game.user.isGM,
			requireApproval: LitmSettings.requireRollApproval,
			isGroupRoll: this.isGroupRoll,
		});
	}

	/**
	 * Adopt a shared roll the Narrator opened.
	 *
	 * This is the whole of the Narrator's Call now: not a configured roll
	 * shipped to a player, but one roll object opened on both screens at once.
	 * The Narrator sets the move, the Might and the tags they invoke *inside*
	 * it; the roller sets theirs. All this does is establish the shared object
	 * — who owns it, what it is about, and that a Narrator called it.
	 *
	 * A fresh call is a fresh roll: selections are cleared, because the
	 * previous roll's invocations were judged against a different situation and
	 * carrying them silently would be a Power error nobody sees. That is also
	 * what makes "changing participants mid-roll resets the dialog" true.
	 *
	 * @param {object} call
	 * @param {string} [call.ownerId]       Who finishes the roll.
	 * @param {string} [call.type]          quick | tracked | mitigate
	 * @param {string} [call.title]         What the roll is for.
	 * @param {string|null} [call.actionUuid]
	 * @param {string[]} [call.participantIds]  Acting Together only.
	 * @param {string} [call.narratorUserId]
	 * @param {string} [call.narratorName]
	 */
	configureSharedRoll({
		ownerId = null,
		type = "quick",
		title = "",
		actionUuid = null,
		participantIds = [],
		narratorUserId = null,
		narratorName = "",
	} = {}) {
		this.#cachedTotalPower = null;
		if (ownerId) this.ownerId = ownerId;
		// A called roll is never a sacrifice — p.150 makes that price the
		// player's to elect, never the Narrator's to demand.
		this.type = !type || type === "sacrifice" ? "quick" : type;
		this.#sacrificeThemeId = null;
		this.#sacrificeStatusName = "";
		this.#mitigation = null;
		this.rollName = title || "";
		this.#actionUuid = actionUuid || null;
		this.#actionDoc = null;
		this.#might = 0;
		this.#modifier = 0;
		this.#tradePower = 0;
		this.#sojournBonus = 0;
		this.#participantIds = [...participantIds];
		this.#selectionMap.clear();
		this.#narratorCall = { narratorUserId, narratorName };
		// The GM viewer's per-actor tab set changes with the participants, so a
		// remembered tab id can name a tab that no longer exists. Drop it and
		// let `buildGmViewerContext` re-seed.
		delete this.tabGroups["gm-viewer"];
		if (this.rendered) this.render();
	}

	setType(type) {
		if (!type) return;
		// The move on a called roll is the Narrator's. The same gate the radio
		// bar and `#handleTypeChange` apply belongs here too: the hero sheet's
		// Sacrifice button calls straight through, which would otherwise let a
		// roller silently turn the Narrator's Quick outcome into a Sacrifice on
		// the shared object they are both looking at.
		//
		// Reactions are the exception. A Consequence landing mid-call is not the
		// player overriding the Narrator's judgement, it is a different roll they
		// are entitled to make (p.147) — and it arrives through this same setter
		// from the chat card, so refusing it would make reacting impossible
		// while a call is open.
		if (type !== "mitigate" && !this.canSetNarratorFields) {
			ui.notifications?.info(t("LITM.Ui.roll_move_is_narrators"));
			return;
		}
		// Mitigation context only makes sense for a reaction; drop it when the
		// player switches away so no stale "Reacting to…" banner survives.
		if (type !== "mitigate") this.#mitigation = null;
		// Sacrifice is its own ritual — clear any pending action so the
		// dialog never shows the action strip alongside the sacrifice grid.
		if (type === "sacrifice") {
			this.#actionUuid = null;
			this.#actionDoc = null;
		}
		this.type = type;
		// Re-render rather than poke the DOM: the move is named in three places
		// that all read `type` out of the render context — the segmented bar,
		// the "Narrator calls for a … roll" banner, and the mitigation banner.
		// `_onRender` reapplies the sacrifice and Trade Power toggles from
		// `this.type`, so the rendered state is the whole state.
		if (this.rendered) this.render();
		// Refresh presence so peers can react to the new type — e.g. the
		// sacrifice banner fires off the flag transition to "sacrifice".
		this.updatePresence(true);
		// And tell the table. A shared roll is one object several people are
		// looking at; a move only this client knows about is how the Narrator
		// ends up calling for one roll while the roller reads another.
		this.#dispatchUpdate();
	}

	/**
	 * Configure this dialog for a camp action. Sets type="campAction" so the
	 * template exposes the no-roll "Spend half" submit option, and adds a
	 * sojourn bonus into the power computation (0 for camp; 1/2/3 for sojourn
	 * by duration). Callers (the camping wizard) compute the bonus and pass it.
	 */
	setCampAction({ sojournBonus = 0 } = {}) {
		this.#sojournBonus = Math.max(0, Number(sojournBonus) || 0);
		this.#cachedTotalPower = null;
		this.type = "campAction";
		if (this.rendered) this.render();
	}

	get ownerId() {
		return this.#ownerId;
	}

	set ownerId(value) {
		this.#ownerId = value;
	}

	get isOwner() {
		return this.#ownerId === game.user.id;
	}

	get actor() {
		return game.actors.get(this.actorId);
	}

	/** @returns {SelectionEntry} */
	getSelection(effectId) {
		return (
			this.#selectionMap.get(effectId) ?? {
				state: "",
				contributorId: null,
				effect: null,
				effectUuid: null,
			}
		);
	}

	setSelection(
		effectId,
		state,
		contributorId = null,
		{ effect = null, effectUuid = null, narrator, ...contributorMeta } = {},
	) {
		this.#cachedTotalPower = null;
		if (!state) {
			this.#selectionMap.delete(effectId);
		} else {
			const existing = this.#selectionMap.get(effectId);
			const entry = {
				state,
				contributorId,
				// Sticky: a Narrator invocation stays a Narrator invocation
				// while it is selected, even when the GM cycles it to another
				// polarity. Clearing it (state "") deletes the entry entirely,
				// which is the way to un-invoke.
				narrator: narrator ?? existing?.narrator ?? false,
				effect: effect ?? existing?.effect ?? null,
				effectUuid: effectUuid ?? effect?.uuid ?? existing?.effectUuid ?? null,
				// Whose tag this is, resolved from the effect rather than from
				// who clicked it: the GM owns an Acting Together roll, so
				// contributor metadata (which only non-owners register) would be
				// blind to exactly the selections the GM makes.
				tagActorId:
					existing?.tagActorId ?? resolveTagActorId(effect?.uuid ?? effectId),
				...(Object.keys(contributorMeta).length
					? contributorMeta
					: {
							contributorActorId: existing?.contributorActorId ?? null,
							contributorActorName: existing?.contributorActorName ?? null,
							contributorActorImg: existing?.contributorActorImg ?? null,
						}),
			};
			this.#selectionMap.set(effectId, entry);
		}
	}

	clearSelections() {
		this.#cachedTotalPower = null;
		this.#selectionMap.clear();
	}

	get selections() {
		return this.#selectionMap;
	}

	/** Scene-tag data reads go through the store — no rendered app required. */
	get #storyTagSidebar() {
		return StoryTagsStore;
	}

	/** @deprecated Public alias kept for modules; prefer StoryTagsStore. */
	get storyTagSidebar() {
		return getStoryTagSidebar() ?? {};
	}

	get statuses() {
		return buildSceneStatusItems((uuid) => this.getSelection(uuid));
	}

	get tags() {
		if (!this.actor) return [];
		return buildSceneStoryTagItems((uuid) => this.getSelection(uuid));
	}

	get gmTags() {
		if (!game.user.isGM) return [];

		const { actors } = this.#storyTagSidebar;
		if (!actors) return [];
		const fellowshipUuid = game.litmv2?.fellowship?.uuid;
		const tags = actors
			.filter(
				(actor) => actor.id !== this.actor.uuid && actor.id !== fellowshipUuid,
			)
			.flatMap((actor) =>
				actor.tags.map((tag) => ({
					...tag,
					actorName: actor.name,
					actorImg: actor.img,
					actorType: actor.type,
				})),
			);
		return tags.map((tag) => {
			const sel = this.getSelection(tag.uuid);
			return {
				...tag,
				state: sel.state || "",
				contributorId: sel.contributorId || null,
				narrator: sel.narrator,
			};
		});
	}

	get totalPower() {
		if (this.#cachedTotalPower != null) return this.#cachedTotalPower;
		const tags = this.#buildTagsFromMap();
		const filtered = LitmRoll.filterTags(tags);
		const { totalPower } = LitmRoll.calculatePower({
			...filtered,
			modifier: this.#modifier + this.#sojournBonus,
			might: this.#might,
		});
		this.#cachedTotalPower = totalPower;
		return totalPower;
	}

	/**
	 * Resolve an ActiveEffect by ID, searching the rolling actor, fellowship, and contributor actors.
	 * Caches the result on the selection entry for subsequent calls.
	 * @param {string} effectId
	 * @param {SelectionEntry} entry
	 * @returns {ActiveEffect|null}
	 */
	#resolveEffect(effectId, entry) {
		if (entry.effect) return entry.effect;
		const effect = foundry.utils.fromUuidSync(effectId);
		if (effect) {
			entry.effect = effect;
			return effect;
		}
		return null;
	}

	/**
	 * Build the tag array for a roll from the selection map.
	 * Each tag includes the full AE metadata (uuid, system, type).
	 * All tags (character effects and scene compendium effects) are resolved via fromUuidSync.
	 * @returns {object[]}
	 */
	#buildTagsFromMap() {
		const result = [];
		for (const [effectId, sel] of this.#selectionMap) {
			if (!sel.state) continue;
			const effect = this.#resolveEffect(effectId, sel);
			if (!effect) continue;
			result.push({
				_id: effect._id,
				id: effect.id,
				uuid: effect.uuid,
				name: effect.name,
				type: effect.type,
				system: effect.system,
				state: sel.state,
				value:
					effect.type === "status_tag"
						? (effect.system?.currentTier ?? 0)
						: undefined,
			});
		}
		return result;
	}

	#buildTagGroups({ isOwner, isGMViewer }) {
		const tagTypeOrder = EFFECT_TAG_ORDER;

		// Tag IDs the current action suggests as helpful / hindering, used to
		// decorate matching tag rows with a highlight in the dialog.
		const action = this.#actionDoc;
		const positiveSuggestedIds = new Set(
			(action?.system.power?.positiveTags ?? [])
				.map((e) => e.tagId)
				.filter(Boolean),
		);
		const negativeSuggestedIds = new Set(
			(action?.system.power?.negativeTags ?? [])
				.map((e) => e.tagId)
				.filter(Boolean),
		);

		// Acting Together: a participant may move their own Hero's tags and the
		// Fellowship's, and no one else's. The GM owns the roll and is
		// unrestricted.
		const actable =
			this.isGroupRoll && !isOwner ? actableActorIds(this) : null;

		const decorateTag = makeTagDecorator({
			isOwner,
			positiveSuggestedIds,
			negativeSuggestedIds,
			actableActorIds: actable,
		});

		const gmTagsFlat = sortByTypeThenName(
			this.gmTags.map(decorateTag),
			tagTypeOrder,
		);
		const gmTagGroupMap = new Map();
		for (const tag of gmTagsFlat) {
			const key = tag.actorName || "";
			if (!gmTagGroupMap.has(key)) {
				gmTagGroupMap.set(key, {
					actorName: tag.actorName,
					actorImg: tag.actorImg,
					tags: [],
				});
			}
			gmTagGroupMap.get(key).tags.push(tag);
		}
		const gmTagGroups = [...gmTagGroupMap.values()];

		// Separate story items by source: scene stays below, actor items join character groups
		const allStoryItems = [
			...sortByTypeThenName(this.statuses.map(decorateTag), tagTypeOrder),
			...sortByTypeThenName(this.tags.map(decorateTag), tagTypeOrder),
		];
		const sceneStoryItems = allStoryItems.filter(
			(tag) => tag.actorName === null,
		);
		const storyTagGroups = sceneStoryItems.length
			? [{ actorName: null, actorImg: null, tags: sceneStoryItems }]
			: [];

		const shared = {
			decorateTag,
			tagTypeOrder,
			allStoryItems,
			sceneStoryItems,
			isOwner,
			isGMViewer,
		};
		return { shared, gmTagGroups, storyTagGroups };
	}

	/**
	 * Rows for selections that count toward Power but have no rendered row on
	 * this client.
	 *
	 * The Narrator invokes the opposition's tags (Core Book p.272), and some of
	 * that opposition is deliberately concealed — the story-tag sidebar hides
	 * a hidden actor's whole column from players. The selection still resolves
	 * through `fromUuidSync` and still lands in the arithmetic, so without this
	 * the player's Power silently drops by a number with nothing on screen to
	 * account for it (#3).
	 *
	 * Concealment is the GM's deliberate feature, so the row is masked rather
	 * than revealed: no name, no actor, but the type and the tier — which is
	 * the part that moves the total. The GM builds none of these: they can see
	 * every row already.
	 *
	 * @param {object[][]} groupLists  Every rendered group collection.
	 * @returns {object[]}
	 */
	#buildConcealedRows(groupLists) {
		if (game.user.isGM) return [];
		const rendered = new Set();
		for (const groups of groupLists) {
			for (const group of groups ?? []) {
				for (const tag of group?.tags ?? []) {
					if (tag?.key) rendered.add(tag.key);
				}
			}
		}
		const rows = [];
		for (const [uuid, sel] of this.#selectionMap) {
			if (!sel.state || rendered.has(uuid)) continue;
			const effect = this.#resolveEffect(uuid, sel);
			if (!effect) continue;
			rows.push({
				key: uuid,
				type: effect.type,
				displayName: t("LITM.Ui.roll_concealed_tag"),
				state: sel.state,
				value:
					effect.type === "status_tag"
						? (effect.system?.currentTier ?? 0)
						: undefined,
				// A one-state cycle: the super-checkbox resolves its value by
				// index into `states`, so a row whose state isn't listed renders
				// as unselected — and a masked row that doesn't show its own
				// polarity is no better than no row at all. It is `locked`
				// anyway, so there is nothing to cycle to.
				states: sel.state,
				locked: true,
				isNarrator: sel.narrator === true,
			});
		}
		return rows;
	}

	async _prepareContext(_options) {
		await StoryTagsStore.loadStoryTags();
		await this.#resolveAction();

		const isOwner = this.isOwner;
		const isGMViewer = game.user.isGM && !isOwner;

		const actionContext = buildActionContext({ action: this.#actionDoc });

		const { shared, gmTagGroups, storyTagGroups } = this.#buildTagGroups({
			isOwner,
			isGMViewer,
		});

		let characterTagGroups = [];
		let fellowshipTagGroups = [];
		let allyTagGroups = [];
		let sceneActorTagGroups = [];
		let gmViewerTabs = [];
		// An Acting Together roll is a per-Hero picker for everyone, owner
		// included: the question is what each participant contributes, not what
		// one character can reach.
		// Acting Together with no Hero of your own in it: every tab collapses to
		// selected-only and an unselected tab renders as nothing, so the window
		// would come up blank. Say why instead.
		let groupRollSpectator = false;
		if (this.isGroupRoll) {
			gmViewerTabs = buildGroupRollTabs(this, shared);
			groupRollSpectator = !isOwner && !actableActorIds(this).size;
		} else if (isGMViewer) {
			gmViewerTabs = buildGmViewerContext(this, shared);
		} else {
			({ characterTagGroups, fellowshipTagGroups } = buildOwnerContext(
				this,
				shared,
			));
			// Player-facing equivalent of the GM's per-actor tag access: the
			// other fellowship heroes' sidebar-visible tags join the Allies
			// tab, and the scene opposition's join the Scene tab. GM-owned
			// rolls skip both — gmTagGroups already lists every sidebar actor
			// in the Scene tab.
			if (!game.user.isGM) {
				allyTagGroups = buildAllyTagGroups(this, shared);
				sceneActorTagGroups = buildSceneActorTagGroups(this, shared);
			}
		}
		// Non-owners only see the rolling actor's tags that were selected
		if (!isOwner) {
			const filterSelected = (groups) =>
				groups
					.map((g) => ({ ...g, tags: g.tags.filter((t) => t.state) }))
					.filter((g) => g.tags.length);
			characterTagGroups = filterSelected(characterTagGroups);
			fellowshipTagGroups = filterSelected(fellowshipTagGroups);
		}

		// A group roll's own per-Hero tabs already show every participant's
		// tags; the contributed panel would list them a second time.
		const contributedTagGroups = this.isGroupRoll
			? []
			: buildContributedTagGroups(this, shared);

		const concealedTags = this.#buildConcealedRows([
			characterTagGroups,
			fellowshipTagGroups,
			allyTagGroups,
			sceneActorTagGroups,
			storyTagGroups,
			gmTagGroups,
			gmViewerTabs.flatMap((tab) => tab.groups ?? []),
			contributedTagGroups.flatMap((c) => c.themeGroups ?? []),
		]);

		// Owner-view tabs (Hero / Allies / Scene) group the tag sections
		// the way the story-tag sidebar does for GMs: each tab is a clean
		// column of related sources. Non-owner views show only selected
		// tags and don't need the tab chrome. GM viewers have their own
		// per-actor tab group above and are handled separately.
		let ownerTabs = [];
		if (isOwner && !this.isGroupRoll) {
			this.tabGroups["roll-tags"] ??= "hero";
			ownerTabs = [
				{ id: "hero", label: t("LITM.Ui.roll_tab_hero") },
				{ id: "allies", label: t("LITM.Ui.roll_tab_allies") },
				{ id: "scene", label: t("LITM.Ui.roll_tab_scene") },
			];
			for (const tab of ownerTabs) {
				tab.cssClass = this.tabGroups["roll-tags"] === tab.id ? "active" : "";
			}
		}

		const sacrificeThemes = this.#ensureSacrificeThemeSelected();

		return {
			actorId: this.actorId,
			characterTagGroups,
			fellowshipName:
				game.litmv2?.fellowship?.name ?? t("LITM.Terms.fellowship"),
			fellowshipTagGroups,
			allyTagGroups,
			sceneActorTagGroups,
			contributedTagGroups,
			ownerTabs,
			rollTypes: {
				quick: "LITM.Ui.roll_quick",
				tracked: "LITM.Ui.roll_tracked",
				mitigate: "LITM.Ui.roll_mitigate",
			},
			storyTagGroups,
			gmTagGroups,
			concealedTags,
			isGM: game.user.isGM,
			isGMViewer,
			// The per-actor tab picker serves two surfaces: a GM watching a
			// player's roll, and everyone in an Acting Together roll.
			useTabbedPicker: isGMViewer || this.isGroupRoll,
			gmViewerTabs,
			groupRollSpectator,
			isOwner,
			// The settings column carries both halves of the roll now, so it
			// renders for the Narrator too — they set the move and the Might on
			// a called roll even while the player owns the dialog.
			showSettings: showsRollSettings({ isOwner, isGM: game.user.isGM }),
			canSetNarratorFields: this.canSetNarratorFields,
			requiresApproval: this.requiresApproval,
			canTradePower: canEditTradePower({
				isOwner,
				isGroupRoll: this.isGroupRoll,
			}),
			isGroupRoll: this.isGroupRoll,
			title: this.rollName,
			type: this.type,
			mitigationBanner:
				this.type === "mitigate" ? mitigationBannerText(this.#mitigation) : "",
			narratorCall: isNarratorControlled(this.#narratorCall)
				? {
						...this.#narratorCall,
						typeLabel: t(`LITM.Ui.roll_${this.type}`),
					}
				: null,
			isCampAction: this.type === "campAction",
			sojournBonus: this.#sojournBonus,
			totalPower: this.totalPower,
			modifier: this.#modifier,
			might: this.#might,
			mightRange: Array.from({ length: 13 }, (_, i) => i - 6),
			tradePower: this.#tradePower,
			canHedge: this.totalPower >= 2,
			canCaution: this.totalPower <= 2,
			sacrificeLevel: this.#sacrificeLevel,
			sacrificeLevelOptions: ["painful", "scarring", "grave"].map((key) => ({
				value: key,
				label: t(`LITM.Ui.sacrifice_${key}`),
				description: game.i18n.format(`LITM.Ui.sacrifice_${key}_price`, {
					tier: maxStatusTier(),
				}),
				selected: this.#sacrificeLevel === key,
			})),
			// #ensureSacrificeThemeSelected auto-selects a valid theme (assigning
			// this.#sacrificeThemeId — the source of truth, read at submit time)
			// and flags the chosen card via `selected` in its return value.
			sacrificeThemes,
			sacrificeStatusName: this.#sacrificeStatusName,
			maxStatusTier: maxStatusTier(),
			// The theme selector serves a different rhetorical purpose per
			// level — Painful scratches it, Scarring removes it, Grave only
			// touches it on Miracle. The legend/hint reflect that intent.
			sacrificeThemeLegend: t(
				this.#sacrificeLevel === "grave"
					? "LITM.Ui.sacrifice_theme_grave_legend"
					: "LITM.Ui.sacrifice_choose_theme",
			),
			sacrificeThemeHint:
				this.#sacrificeLevel === "grave"
					? t("LITM.Ui.sacrifice_theme_grave_hint")
					: "",
			actionContext,
		};
	}

	_onFirstRender(context, options) {
		super._onFirstRender(context, options);

		// Delegated change handler — routes to the appropriate handler based on target
		this.element.addEventListener("change", (event) => {
			const target = event.target;
			if (target.tagName === "LITM-SUPER-CHECKBOX") {
				this._onTagChange(event);
			} else if (target.matches("input[name='might']")) {
				this.#handleMightChange(target);
			} else if (target.matches("input[name='tradePower']")) {
				this.#handleTradePowerChange(target);
			} else if (target.matches("input[name='sacrificeLevel']")) {
				this.#handleSacrificeLevelChange(target);
			} else if (target.matches("input[name='sacrificeStatusName']")) {
				this.#handleSacrificeStatusNameChange(target);
			} else if (target.matches("input[name='type']")) {
				this.#handleTypeChange(target);
			}
		});
	}

	_onRender(context, options) {
		super._onRender(context, options);
		this.#totalPowerEl = null;
		this.#hedgeRadioEl = null;
		this.#cautionRadioEl = null;
		Hooks.callAll("litm.rollDialogRendered", this.actor, this);

		// Might scale tooltip (depends on elements recreated each render)
		const mightLabel = this.element.querySelector(".litm--might-name-wrapper");
		const mightTooltipTemplate = this.element.querySelector(
			".litm--might-tooltip-template",
		);
		if (mightLabel && mightTooltipTemplate) {
			const tooltipContent =
				mightTooltipTemplate.content.firstElementChild.cloneNode(true);
			mightLabel.addEventListener("pointerenter", () => {
				game.tooltip.activate(mightLabel, {
					html: tooltipContent,
					direction: "DOWN",
				});
			});
			mightLabel.addEventListener("pointerleave", () => {
				game.tooltip.deactivate();
			});
		}

		// Apply initial type-dependent visibility
		this.#toggleSacrificeMode(this.type === "sacrifice");
		this.#toggleTradePower(this.type === "tracked");
		this.#updateTotalPower();

		this.#applyAuthorityState();

		this.#restorePresenceIfMissing();
	}

	/**
	 * Put the presence flag back when this client owns a live roll that has
	 * none.
	 *
	 * The Narrator closing their copy of a called roll takes the advert down —
	 * correctly, since a call nobody picked up should not keep advertising the
	 * whole session. But the roller may be midway through that very roll, and
	 * without the flag the rest of the table can neither see nor join it. The
	 * owner is the flag's steward, so an owner finding it gone puts it back.
	 */
	#restorePresenceIfMissing() {
		if (!this.rendered || !this.isOwner) return;
		if (this.actor?.getFlag("litmv2", FLAGS.rollDialogOwner)) return;
		this.updatePresence(true).catch(console.error);
	}

	/**
	 * Disable the controls this client may not move.
	 *
	 * Two separate rules, and they cut in different directions: a non-owner
	 * can't set the move type, and a *non-GM* can't set the move type or the
	 * Might once a Narrator called the roll. The Narrator is the non-owner in
	 * that second case and is precisely the person who must set both, so this
	 * can't be keyed on ownership alone (#4).
	 */
	#applyAuthorityState() {
		if (!this.element) return;
		const canSetNarratorFields = this.canSetNarratorFields;
		const lock = (input) => {
			input.disabled = !canSetNarratorFields;
			if (canSetNarratorFields) input.removeAttribute("aria-disabled");
			else input.setAttribute("aria-disabled", "true");
		};
		for (const input of this.element.querySelectorAll("input[name='type']"))
			lock(input);
		for (const input of this.element.querySelectorAll("input[name='might']"))
			lock(input);
		for (const bar of this.element.querySelectorAll(
			".litm--roll-type-bar, .litm--might-radio-row",
		)) {
			if (bar.classList.contains("litm--trade-power-bar")) continue;
			bar.classList.toggle("is-locked", !canSetNarratorFields);
		}
	}

	/**
	 * @param {object|null} selOrTag  A selection entry or a decorated tag row.
	 * @param {string|null} [uuid]    The tag's uuid. A selection entry is keyed
	 *   by uuid in the map rather than carrying one, so the caller supplies it.
	 */
	#canModifyTag(selOrTag, uuid = null) {
		// Narrator invocations outrank dialog ownership. When the Narrator
		// calls for a roll they invoke the opposition's and the environment's
		// tags (Core Book p.272); handing the dialog to the player makes that
		// player the owner, so this check has to come BEFORE the owner
		// short-circuit or the roller could quietly drop the Narrator's -2.
		if (selOrTag?.narrator && !game.user.isGM) return false;
		if (this.isOwner) return true;
		if (!selOrTag) return false;
		// Acting Together: a participant contributes their own Hero's tag, plus
		// the Fellowship's, which the whole group may invoke (p.157), and
		// nothing else. Contributor-based locking alone wouldn't do it — an
		// unclaimed tag on someone else's Hero has no contributor yet.
		if (this.isGroupRoll && !game.user.isGM) {
			const tagActorId =
				selOrTag.tagActorId ??
				resolveTagActorId(
					uuid ?? selOrTag.effectUuid ?? selOrTag.uuid ?? selOrTag.key,
				);
			if (!tagActorId || !actableActorIds(this).has(tagActorId)) return false;
		}
		const contributorId = selOrTag.contributorId || null;
		return !contributorId || contributorId === game.user.id;
	}

	/**
	 * The one-tag-per-Hero cap (Core Book p.157). Returns true (and warns) when
	 * the selection should be refused because this Hero already has a tag in
	 * the roll. Fellowship theme tags and the opposition's are exempt for free:
	 * they don't resolve to a participating Hero.
	 *
	 * @param {string} uuid
	 * @param {string} value
	 * @returns {boolean}
	 */
	#blocksHeroTagCap(uuid, value) {
		if (!value || !this.isGroupRoll) return false;
		const tagActorId = resolveTagActorId(uuid);
		const conflict = findHeroTagConflict(this.#selectionMap, {
			tagActorId,
			uuid,
			participantIds: this.#participantIds,
		});
		if (!conflict) return false;
		ui.notifications?.warn(t("LITM.Ui.group_tag_cap_warning"));
		return true;
	}

	#revertTagChange(target, currentValue) {
		if (!target) return;
		target.value = currentValue || "";
	}

	_onTagChange(event) {
		const target = event.target;
		const { name: id, value } = target;
		const { type } = target.dataset;
		const isCharacterTag = ALL_TAG_TYPES.has(type);
		// For non-owners, register contributor metadata on first interaction
		if (isCharacterTag && !this.isOwner && !this.#selectionMap.has(id)) {
			this.#registerContributorMeta(id);
		}

		// Check permission: non-owners can only modify tags they contributed or unclaimed tags
		const existingSel = this.getSelection(id);
		if (!this.#canModifyTag(existingSel, id)) {
			this.#revertTagChange(target, existingSel.state);
			return;
		}

		// One tag per Hero in an Acting Together roll (p.157).
		if (this.#blocksHeroTagCap(id, value)) {
			this.#revertTagChange(target, existingSel.state);
			return;
		}

		// Burn cap: only one tag may be burned per roll (p.158). Skip past the
		// blocked scratched state to the NEXT state in this tag's own cycle
		// instead of reverting to "off". For most cycles scratched is last, so
		// the next state wraps to "" — but the GM power-tag cycle is
		// `,positive,scratched,negative`, so skipping must land on "negative"
		// (the Narrator inversion). Hard-reverting to "" would otherwise trap the
		// cursor before "negative", making it unreachable while another tag is
		// burned (#100).
		if (value === "scratched" && findBurnedSelection(this.#selectionMap, id)) {
			ui.notifications?.warn(t("LITM.Ui.burn_cap_warning"));
			const states = (target.getAttribute("states") ?? "").split(",");
			const next = nextStateAfterScratched(states);
			this.#revertTagChange(target, next);
			this.setSelection(
				id,
				next,
				next ? game.user.id : null,
				this.#selectionStamp(),
			);
			this.#updateTotalPower();
			this.#dispatchUpdate();
			return;
		}

		const contributorId = value ? game.user.id : null;
		this.setSelection(id, value, contributorId, this.#selectionStamp());

		this.#updateTotalPower();
		this.#dispatchUpdate();
	}

	/**
	 * Stamp a selection as the Narrator's when the Narrator is the one making
	 * it into someone else's called roll (Core Book p.272 — they invoke the
	 * tags of the target, the opposition or the environment). That stamp is
	 * what `#canModifyTag` and `makeTagDecorator` read to keep the invocation
	 * out of the roller's reach.
	 *
	 * Not stamped when the GM owns the dialog: their picks are then the
	 * roller's picks.
	 *
	 * @returns {object|undefined} extra `setSelection` metadata.
	 */
	#selectionStamp() {
		return game.user.isGM &&
			!this.isOwner &&
			isNarratorControlled(this.#narratorCall)
			? { narrator: true }
			: undefined;
	}

	/**
	 * Register contributor metadata for an effect a non-owner is claiming.
	 * GM viewers scan every sidebar actor; non-owner players check their own
	 * character. First owner of the effect wins.
	 * @param {string} id  Effect UUID
	 */
	#registerContributorMeta(id) {
		const candidates = [];
		if (game.user.isGM) {
			for (const sidebarActor of this.#storyTagSidebar.actors ?? []) {
				const actor = foundry.utils.fromUuidSync(sidebarActor.id);
				if (actor && actor.id !== this.actor?.id) candidates.push(actor);
			}
		}
		if (game.user.character) candidates.push(game.user.character);

		for (const actor of candidates) {
			const allTags = (actor.system.allRollTags ?? []).map(effectToPlain);
			const found = allTags.find((t) => t.uuid === id);
			if (!found) continue;
			this.setSelection(id, "", null, {
				effectUuid: found.uuid,
				contributorActorId: actor.id,
				contributorActorName: actor.name,
				contributorActorImg: actor.prototypeToken?.texture?.src || actor.img,
			});
			return;
		}
	}

	addTag(tag, toScratch) {
		const state =
			tag.type === "weakness_tag"
				? "negative"
				: toScratch
					? "scratched"
					: "positive";
		this.setSelection(tag.uuid ?? tag.id ?? tag._id, state, game.user.id);
	}

	removeTag(tag) {
		this.setSelection(tag.uuid ?? tag.id ?? tag._id, "");
		this.#updateTotalPower();
		this.#dispatchUpdate();
	}

	setCharacterTagState(tagId, state) {
		// Sheet-side tag clicks land here rather than in `_onTagChange`, so the
		// same two gates have to hold on this path. A Narrator can invert one of
		// the Hero's own power tags (p.76), which puts a narrator-stamped row on
		// that Hero's sheet — clicking it there must not drop the invocation.
		if (!this.#canModifyTag(this.getSelection(tagId), tagId)) return;
		if (this.#blocksHeroTagCap(tagId, state)) return;
		const contributorId = state ? game.user.id : null;
		this.setSelection(tagId, state || "", contributorId);
		this.#updateTotalPower();
		this.#dispatchUpdate();
	}

	reset() {
		this.#cachedTotalPower = null;
		this.clearSelections();
		this.#modifier = 0;
		this.#might = 0;
		this.#tradePower = 0;
		this.#sacrificeLevel = "painful";
		this.#sacrificeThemeId = null;
		this.#sacrificeStatusName = "";
		this.#actionUuid = null;
		this.#actionDoc = null;
		this.#sojournBonus = 0;
		this.#mitigation = null;
		this.#narratorCall = null;
		this.#participantIds = [];
		this.rollName = "";
		this.type = "quick";
		// reset() is state-only — it must NOT close the dialog. Closing is
		// owned by `closeOnSubmit` on the owner's client and by the
		// `closeRollDialog` socket on viewers (broadcast from the owner's
		// close()). This reset runs inside the awaited submit handler (via the
		// roll pipeline), i.e. *before* closeOnSubmit — so a close here fired a
		// SECOND close per submit. Render and close share one Semaphore, so a
		// "Roll this action" click landing between the two closes had its
		// reopen render torn down by the trailing close: the dialog silently
		// stayed shut and the button appeared to do nothing until retried.
		if (this.actor?.sheet?.rendered) this.actor.sheet.render(true);
	}

	async updatePresence(isOpen) {
		// Normally only the owner advertises their own open dialog. The one
		// exception is a roll the Narrator called: they set the flag on the
		// roller's behalf when they opened it, so retracting it is theirs too.
		const mayWrite =
			this.isOwner ||
			(game.user.isGM && isNarratorControlled(this.#narratorCall));
		if (!mayWrite) return;
		if (isOpen) {
			const existing = this.actor?.getFlag("litmv2", FLAGS.rollDialogOwner);
			await this.actor?.setFlag("litmv2", FLAGS.rollDialogOwner, {
				ownerId: this.ownerId,
				// Preserve the original openedAt across type changes so the
				// banner watcher doesn't re-fire on every setType refresh.
				openedAt: existing?.openedAt ?? Date.now(),
				type: this.type ?? "quick",
				// Keep the seat marked as assigned. Without this a re-assert
				// would drop the marker `renderRollDialog` reads, and a reload
				// would recompute ownership on a roll that already has an owner.
				...(isNarratorControlled(this.#narratorCall) ? { narrator: true } : {}),
			});
		} else {
			await this.actor?.unsetFlag("litmv2", FLAGS.rollDialogOwner);
		}
	}

	async close(options) {
		const wasRendered = this.rendered;
		// The Narrator who called a roll wrote the presence flag on the roller's
		// behalf, so closing their own copy takes the advert down with it —
		// otherwise a call nobody picked up leaves a "click to join" strip on
		// the whole table with nothing behind it.
		//
		// It does NOT close the roller's window. The Narrator closing a dialog
		// to look at something else is not them withdrawing the roll, and the
		// two are indistinguishable from here: Escape, the X and the `R`
		// keybinding all land in this method. Tearing down a player's
		// in-progress roll on any of them is the worse failure.
		const narratorRetracting =
			!this.isOwner &&
			game.user.isGM &&
			isNarratorControlled(this.#narratorCall);
		const result = await super.close(options);
		if (this.isOwner) {
			await this.updatePresence(false);
			if (wasRendered)
				Sockets.dispatch("closeRollDialog", { actorId: this.actorId });
		} else if (narratorRetracting) {
			await this.updatePresence(false);
		}
		if (wasRendered) Hooks.callAll("litm.rollDialogClosed", this.actor);
		return result;
	}

	#handleTypeChange(target) {
		// The template renders these disabled, but the change handler is the
		// boundary that actually holds — same shape as `#canModifyTag`, which
		// reverts rather than trusting the markup. Kept here rather than left
		// to `setType`, whose gate deliberately lets a reaction through: the
		// bar offers `mitigate` too, and on a called roll it is not the
		// roller's to pick.
		if (!this.canSetNarratorFields) {
			this.#restoreRadio("type", this.type);
			return;
		}
		// One way to change the move. The bar used to set `this.type` and patch
		// the DOM itself, which left every other thing that names the move —
		// the call banner above all — reading the previous one.
		this.setType(target.value);
	}

	#toggleSacrificeMode(isSacrifice) {
		if (!this.element) return;
		// Hide might/modifier and total power for sacrifice rolls
		const mightFieldset = this.element
			.querySelector(".litm--roll-dialog-might")
			?.closest("fieldset");
		const totalPowerEl = this.element.querySelector(
			".litm--roll-dialog-total-power",
		);
		const sacrificeFieldset = this.element.querySelector(
			".litm--sacrifice-level-fieldset",
		);
		const tagsFieldset = this.element.querySelector(
			".litm--roll-dialog-tags-fieldset",
		);
		// The owner-view tag-category nav lives in the same column wrapper
		// as the tags fieldset — hide them together so the column collapses
		// entirely during sacrifice rolls instead of leaving an orphan nav.
		const tagsColumn = this.element.querySelector(
			".litm--roll-dialog-tags-column",
		);
		const typeBar = this.element.querySelector(".litm--roll-type-bar");
		if (mightFieldset) mightFieldset.classList.toggle("hidden", isSacrifice);
		if (totalPowerEl) totalPowerEl.classList.toggle("hidden", isSacrifice);
		if (sacrificeFieldset)
			sacrificeFieldset.classList.toggle("hidden", !isSacrifice);
		if (tagsFieldset) tagsFieldset.classList.toggle("hidden", isSacrifice);
		if (tagsColumn) tagsColumn.classList.toggle("hidden", isSacrifice);
		// Sacrifice is its own ritual — quick/tracked/mitigate make no sense
		// during it. Hide the roll-type bar entirely in sacrifice mode.
		if (typeBar) typeBar.classList.toggle("hidden", isSacrifice);
		// Toggle level-specific subfields (theme selector + grave status input)
		this.#toggleSacrificeSubfields(isSacrifice ? this.#sacrificeLevel : null);
	}

	#toggleSacrificeSubfields(level) {
		if (!this.element) return;
		const themeFieldset = this.element.querySelector(
			".litm--sacrifice-theme-fieldset",
		);
		const graveFieldset = this.element.querySelector(
			".litm--sacrifice-grave-fieldset",
		);
		// Theme selector is shown for every sacrifice level — it represents
		// the theme that is paid (painful/scarring) or the theme to lose on
		// Miracle (grave). Hidden only when sacrifice mode itself is off.
		const showTheme =
			level === "painful" || level === "scarring" || level === "grave";
		if (themeFieldset) themeFieldset.classList.toggle("hidden", !showTheme);
		// Grave-only: status name input for the top-tier status on fail/snc.
		if (graveFieldset)
			graveFieldset.classList.toggle("hidden", level !== "grave");
	}

	// Mirrors #onSetSacrificeLevel (the data-action click handler) but is the
	// KEYBOARD path: arrow-key navigation on the sacrificeLevel radio group
	// fires `change` without a click, so this is not a removable duplicate.
	#handleSacrificeLevelChange(target) {
		const level = target.value;
		if (!level || level === this.#sacrificeLevel) return;
		this.#sacrificeLevel = level;
		this.#applySacrificeLevelToDom(level);
		this.#toggleSacrificeSubfields(this.#sacrificeLevel);
		this.#dispatchUpdate();
	}

	#handleSacrificeStatusNameChange(target) {
		this.#sacrificeStatusName = target.value || "";
		this.#dispatchUpdate();
	}

	/** The hero's sacrificeable themes (its own themes + story themes, never the
	 *  fellowship theme), unsorted. Spent-ness is computed by {@link isThemeSpent}. */
	#sacrificeThemeItems() {
		if (!this.actor) return [];
		return this.actor.items.filter(
			(i) =>
				(i.type === "theme" && !i.system.isFellowship) ||
				i.type === "story_theme",
		);
	}

	#ensureSacrificeThemeSelected() {
		const themes = this.#sacrificeThemeItems().sort((a, b) => a.sort - b.sort);
		if (themes.length === 0) return [];
		// Auto-select. Painful can't target a spent theme, so prefer the first
		// live one; only fall back to a spent theme if every theme is spent.
		const isPainful = this.#sacrificeLevel === "painful";
		const current = themes.find((t) => t.id === this.#sacrificeThemeId);
		const currentInvalid = !current || (isPainful && isThemeSpent(current));
		if (currentInvalid) {
			const firstLive = isPainful ? themes.find((t) => !isThemeSpent(t)) : null;
			this.#sacrificeThemeId = (firstLive ?? themes[0]).id;
		}
		const trackPips = (value) =>
			Array.from({ length: 3 }, (_, i) => ({ filled: i < (value ?? 0) }));
		return themes.map((theme) => {
			const effects = [...theme.effects];
			const powerTags = effects
				.filter(
					(e) =>
						(e.type === "power_tag" || e.type === "fellowship_tag") &&
						!e.disabled &&
						!e.system?.isTitleTag,
				)
				.map((e) => e.name);
			const spent = isThemeSpent(theme);
			const weaknessTags = effects
				.filter((e) => e.type === "weakness_tag" && !e.disabled)
				.map((e) => e.name);
			const specialImprovements = (theme.system?.specialImprovements ?? [])
				.filter((si) => si.isActive && (si.name || "").trim())
				.map((si) => si.name);
			const level = theme.system?.level || "";
			return {
				id: theme.id,
				name: theme.name,
				themebook: theme.system?.themebook || "",
				level,
				levelLabel: level ? game.i18n.localize(`LITM.Terms.${level}`) : "",
				quest: theme.system?.quest?.description || "",
				powerTags,
				weaknessTags,
				specialImprovements,
				hasTags: powerTags.length + weaknessTags.length > 0,
				tracks: [
					{
						label: game.i18n.localize("LITM.Themes.abandon"),
						pips: trackPips(theme.system?.quest?.tracks?.abandon?.value),
					},
					{
						label: game.i18n.localize("LITM.Ui.improve"),
						pips: trackPips(theme.system?.improve?.value),
					},
					{
						label: game.i18n.localize("LITM.Themes.milestone"),
						pips: trackPips(theme.system?.quest?.tracks?.milestone?.value),
					},
				],
				spent,
				selected: theme.id === this.#sacrificeThemeId,
			};
		});
	}

	#toggleTradePower(isTracked) {
		if (!this.element) return;
		// Acting Together resolves one roll for the whole group, so there is no
		// single roller to strike the hedge's bargain (p.157).
		const show =
			isTracked &&
			canEditTradePower({
				isOwner: this.isOwner,
				isGroupRoll: this.isGroupRoll,
			});
		const fieldset = this.element.querySelector(".litm--trade-power-fieldset");
		if (fieldset) fieldset.classList.toggle("hidden", !show);
		// Only the owner's Trade Power is real; every other client holds a
		// mirror of it. Clearing on `!show` alone zeroed that mirror on every
		// viewer render, and `#dispatchUpdate` sends it straight back — so a
		// helper contributing a tag, or the Narrator setting Might, silently
		// cancelled the roller's Hedge. Non-owners hide the row and touch
		// nothing.
		if (this.isOwner && !show && this.#tradePower !== 0) {
			this.#resetTradePower();
			this.#updateTotalPower();
		}
	}

	#handleTradePowerChange(target) {
		this.#cachedTotalPower = null;
		this.#tradePower = Number(target.value) || 0;
		// Update active state on trade power bar
		this.element
			.querySelectorAll(".litm--trade-power-bar .litm--roll-type-option")
			.forEach((label) => {
				const radio = label.querySelector("input[type='radio']");
				label.classList.toggle(
					"is-active",
					radio?.value === String(this.#tradePower),
				);
			});
		this.#updateTotalPower();
		this.#dispatchUpdate();
	}

	/** Put a radio group back on the value the dialog still holds, after a
	 *  change this client was not entitled to make. */
	#restoreRadio(name, value) {
		const radio = this.element?.querySelector(
			`input[name='${name}'][value='${value}']`,
		);
		if (radio) radio.checked = true;
	}

	#handleMightChange(target) {
		if (!this.canSetNarratorFields) {
			this.#restoreRadio("might", this.#might);
			return;
		}
		this.#cachedTotalPower = null;
		this.#might = Number(target.value) || 0;
		this.element.querySelectorAll(".litm--might-option").forEach((label) => {
			const radio = label.querySelector("input[type='radio']");
			label.classList.toggle("is-active", radio?.value === String(this.#might));
		});
		this.#updateTotalPower();
		this.#dispatchUpdate();
	}

	/** @type {HTMLElement|null} Cached by _onRender. */
	#totalPowerEl = null;
	/** @type {HTMLInputElement|null} Cached by _onRender. */
	#hedgeRadioEl = null;
	/** @type {HTMLInputElement|null} Cached by _onRender. */
	#cautionRadioEl = null;

	#updateTotalPower() {
		if (!this.element) return;
		const totalPower = this.totalPower;
		this.#totalPowerEl ??= this.element.querySelector(
			"[data-update='totalPower']",
		);
		this.#hedgeRadioEl ??= this.element.querySelector(
			"input[name='tradePower'][value='1']",
		);
		this.#cautionRadioEl ??= this.element.querySelector(
			"input[name='tradePower'][value='-1']",
		);

		if (this.#cautionRadioEl) {
			const canCaution = totalPower <= 2;
			this.#cautionRadioEl.disabled = !canCaution;
			this.#cautionRadioEl
				.closest(".litm--roll-type-option")
				?.classList.toggle("is-disabled", !canCaution);
			if (!canCaution && this.#tradePower === -1) this.#resetTradePower();
		}

		if (this.#hedgeRadioEl) {
			const canHedge = totalPower >= 2;
			this.#hedgeRadioEl.disabled = !canHedge;
			this.#hedgeRadioEl
				.closest(".litm--roll-type-option")
				?.classList.toggle("is-disabled", !canHedge);
			if (!canHedge && this.#tradePower === 1) this.#resetTradePower();
		}

		if (this.#totalPowerEl) {
			const trade = this.#tradePower;
			if (trade) {
				const rollPower = totalPower + trade;
				const spendPower = Math.max(totalPower - trade, 1);
				this.#totalPowerEl.innerHTML = `${totalPower} <span class="litm--trade-annotation">(${t("LITM.Terms.roll")}: ${rollPower >= 0 ? "+" : ""}${rollPower}, ${t("LITM.Ui.spend_power")}: ${spendPower})</span>`;
			} else {
				this.#totalPowerEl.textContent = totalPower;
			}
		}
	}

	#resetTradePower() {
		this.#cachedTotalPower = null;
		this.#tradePower = 0;
		const noneRadio = this.element.querySelector(
			"input[name='tradePower'][value='0']",
		);
		if (noneRadio) noneRadio.checked = true;
		this.element
			.querySelectorAll(".litm--trade-power-bar .litm--roll-type-option")
			.forEach((label) => {
				const radio = label.querySelector("input[type='radio']");
				label.classList.toggle("is-active", radio?.value === "0");
			});
	}

	async _createModerationRequest(data) {
		const id = foundry.utils.randomID();
		const userId = game.user.id;
		const type = data.type || "quick";
		const isSacrifice = type === "sacrifice";
		// Sacrifice rolls are pure 2d6 — tags and Power don't contribute, so
		// the tooltip/total-power block is irrelevant on the moderation card.
		const preview = isSacrifice
			? null
			: buildRollPreview({
					tags: data.tags,
					modifier: data.modifier,
					might: data.might,
				});
		const actionName =
			this.rollName || this.actionDoc?.name || data.title || "";
		const sacrificeLevelLabel =
			isSacrifice && data.sacrificeLevel
				? t(`LITM.Ui.sacrifice_${data.sacrificeLevel}`)
				: "";
		const themeName =
			isSacrifice && data.sacrificeThemeId
				? this.actor?.items?.get(data.sacrificeThemeId)?.name || ""
				: "";
		const rollTypeLabel = t(`LITM.Ui.roll_${type}`);
		await foundry.documents.ChatMessage.create({
			content: await foundry.applications.handlebars.renderTemplate(
				"systems/litmv2/templates/chat/moderation.html",
				{
					title: t("LITM.Ui.roll_moderation"),
					id: this.actor.id,
					rollId: id,
					type,
					isSacrifice,
					actionName,
					rollTypeLabel,
					sacrificeLevel: data.sacrificeLevel,
					sacrificeLevelLabel,
					sacrificeThemeId: data.sacrificeThemeId,
					themeName,
					name: this.actor.name,
					hasTooltipData: preview?.hasTooltipData ?? false,
					tooltipData: preview?.tooltipData ?? {},
					totalPower: preview?.totalPower ?? 0,
				},
			),
			flags: { litmv2: { id, userId, data: { ...data, type } } },
		});
	}

	#dispatchUpdate() {
		// Same self-heal as `_onRender`, on the other path a live roll takes:
		// most owner edits update the DOM in place rather than re-rendering, so
		// without this the advert stays down until something forces a render.
		this.#restorePresenceIfMissing();
		// Strip non-serializable AE references from selection entries
		const selections = [...this.#selectionMap].map(([id, entry]) => {
			const { effect, ...serializable } = entry;
			return [id, serializable];
		});
		Sockets.dispatch("updateRollDialog", {
			actorId: this.actorId,
			selections,
			type: this.type,
			modifier: this.#modifier,
			might: this.#might,
			tradePower: this.#tradePower,
			sacrificeLevel: this.#sacrificeLevel,
			sacrificeThemeId: this.#sacrificeThemeId,
			sacrificeStatusName: this.#sacrificeStatusName,
			ownerId: this.ownerId,
			// The stamp rides the sync, not just the opening socket: a client
			// that joins through the HUD strip or `requestRollDialogSync` has to
			// learn the roll was *called*, or it renders the Narrator's move and
			// Might as the joiner's to change.
			narratorCall: this.#narratorCall,
			participantIds: this.#participantIds,
		});
	}

	dispatchSync() {
		this.#dispatchUpdate();
	}

	async receiveUpdate({
		selections,
		actorId,
		type,
		modifier,
		might,
		tradePower,
		sacrificeLevel,
		sacrificeThemeId,
		sacrificeStatusName,
		ownerId,
		narratorCall,
		participantIds,
	}) {
		if (actorId !== this.actorId) return;

		this.#cachedTotalPower = null;
		if (narratorCall !== undefined) this.#narratorCall = narratorCall;
		if (participantIds !== undefined)
			this.#participantIds = [...participantIds];
		if (type !== undefined) this.type = type;
		if (modifier !== undefined) this.#modifier = modifier;
		if (might !== undefined) this.#might = might;
		if (tradePower !== undefined) this.#tradePower = tradePower;
		if (sacrificeLevel !== undefined) this.#sacrificeLevel = sacrificeLevel;
		if (sacrificeThemeId !== undefined)
			this.#sacrificeThemeId = sacrificeThemeId;
		if (sacrificeStatusName !== undefined)
			this.#sacrificeStatusName = sacrificeStatusName;
		if (ownerId !== undefined) this.ownerId = ownerId;

		// Merge selectionMap: prefer local entries where this user contributed
		if (selections) {
			const incoming = new Map(selections);
			const merged = new Map(incoming);
			for (const [id, local] of this.#selectionMap) {
				if (local.contributorId === game.user.id && local.state) {
					merged.set(id, local);
				}
			}
			this.#selectionMap = merged;
		}

		if (this.actor?.sheet?.rendered) this.actor.sheet.render();
		if (this.rendered) this.render();
	}
}
