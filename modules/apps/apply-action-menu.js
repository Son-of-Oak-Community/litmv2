import { maxStatusTier } from "../active-effects/status-tag-data.js";
import { applyConsequence } from "../item/action/chat-actions.js";
import { error } from "../logger.js";
import { FLAGS } from "../system/config.js";
import { LitmSettings } from "../system/settings.js";
import { enrichHTML, getStoryTagSidebar, localize as t } from "../utils.js";
import {
	buildConsequenceItem,
	gatherSidebarConsequences,
} from "./consequence-sources.js";
import { adjustCounter, readVariableTiers } from "./counter-controls.js";
import { stripActorPrefix } from "./spend-power-service.js";
import { StoryTagsStore } from "./story-tags/story-tags-store.js";
import { getTargetCandidates } from "./target-picker.js";

/**
 * GM-only modal for applying an Action's consequences in one batch.
 * Visually echoes SpendPowerApp — option rows with checkbox + label + hint
 * — so the GM resolves consequences with the same vocabulary players use
 * to spend power on successes.
 *
 * Player-side action successes live in SpendPowerApp directly (above the
 * generic spend options).
 *
 * Constructor options: { messageId }.
 */
export class ApplyActionMenuApp extends foundry.applications.api.HandlebarsApplicationMixin(
	foundry.applications.api.ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-apply-action",
		classes: ["litm", "litm-spend-power"],
		tag: "form",
		window: { resizable: true },
		position: { width: 520, height: 600 },
		form: {
			handler: ApplyActionMenuApp.#onSubmit,
			closeOnSubmit: true,
		},
		actions: {
			"counter-inc": ApplyActionMenuApp.#onCounter,
			"counter-dec": ApplyActionMenuApp.#onCounter,
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/apps/apply-action-menu.html",
			templates: ["systems/litmv2/templates/partials/consequence-option.html"],
		},
	};

	constructor(options = {}) {
		super(options);
		this.messageId = options.messageId;
	}

	get title() {
		return t("LITM.Actions.consequences_menu_title");
	}

	_getMessage() {
		return this.messageId ? game.messages.get(this.messageId) : null;
	}

	async _getAction() {
		const message = this._getMessage();
		const uuid = message?.getFlag("litmv2", FLAGS.actionUuid);
		if (!uuid) return null;
		const action = await foundry.utils.fromUuid(uuid);
		return action?.type === "action" ? action : null;
	}

	async _prepareContext(_options) {
		const message = this._getMessage();
		if (!message) return { items: [], sources: [], empty: true };
		// The action is optional: a Quick roll has none, but in-play
		// challenges/journeys still contribute consequences to apply.
		const action = await this._getAction();

		// Stored applied keys may be legacy numeric indices — normalize to
		// strings so they match the action path's `String(index)` keys.
		const appliedKeys = new Set(
			(message.getFlag("litmv2", "appliedConsequences") ?? []).map(String),
		);
		// Push Your Luck adds one consequence to a clean Success (Core Book
		// p.158). Once one has been applied to a pushed roll, the rest lock.
		const isPushed = message.rolls?.[0]?.litm?.pushed === true;
		const pushedLocked = isPushed && appliedKeys.size >= 1;

		// Own consequences exist only when the roll came from an action item.
		// Render prose through the full enricher (bold, tag chips, links) so the
		// menu matches the challenge sheet and chat cards — proseChipsHtml only
		// did chips, leaving `**bold**` literal.
		const items = action
			? await Promise.all(
					(action.system.consequences ?? []).map(async (text, index) =>
						buildConsequenceItem(text, String(index), {
							index,
							applied: appliedKeys.has(String(index)),
							disabled: pushedLocked,
							sourceUuid: "",
							sourceLabel: action.name,
							html: await enrichHTML(text, action),
						}),
					),
				)
			: [];

		// Contributed consequences: every challenge/journey in the story-tag
		// sidebar offers its vignettes' consequences, grouped by vignette.
		const sidebarActors = StoryTagsStore.resolveTrackedActors().map(
			(tracked) => tracked.actor,
		);
		const sources = await gatherSidebarConsequences({
			actors: sidebarActors,
			appliedKeys,
			disabled: pushedLocked,
			enrich: (text, doc) => enrichHTML(text, doc),
		});

		// In-play actors as one-click target chips. Deliberately narrowed to the
		// player side (heroes / story themes / fellowship): RAW, Consequences are
		// what a Challenge delivers *to* the Heroes (Core p.147/149). A Challenge
		// changing itself as a Consequence (a group rallying more Numbers) is the
		// Narrator's call on that sheet, not a batch-apply target. The rolling
		// actor is pre-selected for the common case.
		const rollingActorId =
			message.rolls?.[0]?.litm?.actorId ?? message.speaker?.actor ?? null;
		const targets = getTargetCandidates({
			allowSelf: true,
			types: ["hero", "story_theme", "fellowship"],
		}).map((c) => ({
			id: c.id,
			name: c.label,
			img: c.img,
			selected: c.id === rollingActorId,
		}));

		return {
			actionName: action?.name ?? "",
			items,
			sources,
			targets,
			rollingActorId,
			empty: items.length === 0 && sources.length === 0,
			isPushed,
			pushedLocked,
			inputType: isPushed ? "radio" : "checkbox",
		};
	}

	/** @this {ApplyActionMenuApp} */
	static #onCounter(_event, target) {
		// min=0 so a consequence with multiple variable-tier statuses lets
		// the GM pick which ones to apply (mirror to the apply-success path
		// in SpendPowerApp). A token left at 0 is skipped.
		adjustCounter(target, { min: 0, max: maxStatusTier() });
	}

	static async #onSubmit(_event, form, _formData) {
		const message = this._getMessage();
		if (!message) return;
		// Optional: a Quick roll has no action, only contributed consequences.
		const action = await this._getAction();

		if (!game.user.isGM) {
			ui.notifications.info(t("LITM.Actions.gm_only"));
			return;
		}

		const isPushed = message.rolls?.[0]?.litm?.pushed === true;
		let checkedKeys = Array.from(
			form.querySelectorAll("input[name='option']:checked"),
		).map((el) => el.value);
		if (!checkedKeys.length) return;
		// Push Your Luck imposes exactly one consequence on the otherwise-clean
		// Success — defensive cap in case the template's radio constraint is
		// bypassed (eg. by browser DOM tampering or a re-render race).
		if (isPushed) checkedKeys = checkedKeys.slice(0, 1);

		// Target chips pick the actors — every checked chip suffers each
		// checked consequence. Falls back to the rolling actor when no chip
		// is selected; pre-selection in the template already defaults to them.
		const selectedIds = Array.from(
			form.querySelectorAll("input[name='target']:checked"),
		).map((el) => el.value);
		const fallbackId =
			message.rolls?.[0]?.litm?.actorId ?? message.speaker?.actor ?? null;
		const targetIds = selectedIds.length ? selectedIds : [fallbackId];
		const actors = targetIds.map((id) => (id ? game.actors.get(id) : null));

		const newlyApplied = [];
		for (const key of checkedKeys) {
			const optionLi = form.querySelector(
				`.litm-spend-power__option[data-key="${key}"]`,
			);
			if (!optionLi) continue;

			const sourceUuid = optionLi.dataset.sourceUuid || "";
			const index = Number(optionLi.dataset.conseqIndex);
			if (!Number.isFinite(index)) continue;

			// A source uuid → the consequence belongs to a sidebar challenge/
			// journey vignette; otherwise it's the rolled action's own.
			let text;
			if (sourceUuid) {
				const vignette = await foundry.utils.fromUuid(sourceUuid);
				text = vignette?.system?.consequences?.[index];
			} else {
				text = (action?.system?.consequences ?? [])[index];
			}
			if (!text) continue;

			// Stored card footer names the source. data-source-label is the
			// viewer-independent public name, so a concealed challenge's real
			// name never bakes into the broadcast card.
			const footerLabel = optionLi.dataset.sourceLabel || action?.name || "";
			const chosenTiers = readVariableTiers(optionLi);

			let appliedAny = false;
			for (const actor of actors) {
				let result;
				try {
					result = await applyConsequence({ text, actor, chosenTiers });
				} catch (err) {
					error("Failed to apply consequence:", err);
					ui.notifications.error(t("LITM.Actions.apply_failed"));
					continue;
				}
				if (!result) continue;
				appliedAny = true;

				if (actor) await ApplyActionMenuApp.#ensureActorInSidebar(actor);

				await foundry.documents.ChatMessage.create({
					speaker: { alias: game.user.name },
					content: await foundry.applications.handlebars.renderTemplate(
						"systems/litmv2/templates/chat/action-applied.html",
						{
							actorImg: actor?.img,
							actorName: actor?.system.publicName ?? actor?.name,
							label: t("LITM.Terms.consequences"),
							summary: stripActorPrefix(
								result.appliedSummary,
								actor?.system.publicName ?? actor?.name,
							),
							footer: footerLabel,
							reactActorId: actor?.id ?? null,
						},
					),
					// Carry the inflicted effects so a Reaction rolled from this
					// card knows what it's mitigating (banner + spend-menu
					// pre-target). sourceLabel is the viewer-independent public
					// name (footerLabel), matching the stored footer.
					flags: {
						litmv2: {
							consequence: {
								effects: result.applied ?? [],
								sourceLabel: footerLabel,
								targetActorId: actor?.id ?? null,
							},
						},
					},
				});
			}
			if (appliedAny) newlyApplied.push(key);
		}

		// Record applied keys (strings) in one write; dedupe and normalize any
		// legacy numeric entries so the ✓ markers stay consistent.
		if (newlyApplied.length) {
			const appliedNow = (
				message.getFlag("litmv2", "appliedConsequences") ?? []
			).map(String);
			await message.setFlag("litmv2", "appliedConsequences", [
				...new Set([...appliedNow, ...newlyApplied]),
			]);
		}
	}

	/**
	 * Append the actor's uuid to the story-tag sidebar config when missing
	 * so consequence-applied tags/statuses are visible in the Manage Tags &
	 * Statuses window without forcing the GM to add the actor by hand.
	 */
	static async #ensureActorInSidebar(actor) {
		if (!game.user.isGM) return;
		const config = StoryTagsStore.config;
		const existing = config.actors ?? [];
		if (existing.includes(actor.uuid)) return;
		await LitmSettings.setStoryTags({
			...config,
			actors: [...existing, actor.uuid],
		});
		StoryTagsStore.invalidateCache();
		getStoryTagSidebar()?.render();
	}
}
