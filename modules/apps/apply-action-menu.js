import { scanMarkup } from "../item/action/action-rules.js";
import { applyConsequence } from "../item/action/chat-actions.js";
import { error } from "../logger.js";
import { proseChipsHtml } from "../system/renderers/renderer-utils.js";
import { LitmSettings } from "../system/settings.js";
import { getStoryTagSidebar, localize as t } from "../utils.js";
import { adjustCounter, readVariableTiers } from "./counter-controls.js";
import { stripActorPrefix } from "./spend-power-service.js";
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
		position: { width: 520, height: "auto" },
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
		form: { template: "systems/litmv2/templates/apps/apply-action-menu.html" },
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
		const uuid = message?.getFlag("litmv2", "actionUuid");
		if (!uuid) return null;
		const action = await foundry.utils.fromUuid(uuid);
		return action?.type === "action" ? action : null;
	}

	async _prepareContext(_options) {
		const message = this._getMessage();
		const action = await this._getAction();
		if (!message || !action) return { items: [], empty: true };

		const sys = action.system;
		const applied = new Set(
			message.getFlag("litmv2", "appliedConsequences") ?? [],
		);
		// Push Your Luck adds one consequence to a clean Success (Core Book
		// p.158). Once a consequence has been applied to a pushed roll, the
		// remaining entries are locked so the GM can't keep adding more.
		const isPushed = message.rolls?.[0]?.litm?.pushed === true;
		const appliedCount = applied.size;
		const pushedLocked = isPushed && appliedCount >= 1;
		const items = (sys.consequences ?? []).map((text, index) => {
			const varTokens = [];
			let v = 0;
			for (const tok of scanMarkup(text)) {
				if (tok.type === "status" && tok.isVariable) {
					varTokens.push({ idx: v, name: tok.name });
					v++;
				}
			}
			// Applied entries stay enabled — consequences are options, and the
			// Narrator may deal the same one to another hero. The `applied`
			// flag only drives the ✓ marker. Pushed rolls still lock after
			// their single consequence.
			return {
				key: String(index),
				text: proseChipsHtml(text),
				varTokens,
				hasVariableTier: varTokens.length > 0,
				applied: applied.has(index),
				disabled: pushedLocked,
			};
		});

		// Scene actors as one-click target chips — token-less, theatre-of-mind
		// scenes fall back to observable sidebar actors (same candidate list
		// as the Spend Power target row). Rolling actor is the default pick so
		// the common "consequences for the player who rolled" case works
		// without an extra click.
		const rollingActorId =
			message.rolls?.[0]?.litm?.actorId ?? message.speaker?.actor ?? null;
		const targets = getTargetCandidates({ allowSelf: true }).map((c) => ({
			id: c.id,
			name: c.label,
			img: c.img,
			selected: c.id === rollingActorId,
		}));

		return {
			actionName: action.name,
			items,
			targets,
			rollingActorId,
			empty: items.length === 0,
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
		adjustCounter(target, { min: 0, max: 6 });
	}

	static async #onSubmit(_event, form, _formData) {
		const message = this._getMessage();
		const action = await this._getAction();
		if (!message || !action) return;

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
			const index = Number(key);
			if (!Number.isFinite(index)) continue;
			const text = (action.system.consequences ?? [])[index];
			if (!text) continue;

			const optionLi = form.querySelector(
				`.litm-spend-power__option[data-key="${index}"]`,
			);
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

				// Ensure the target lives in the story-tag sidebar so the GM can
				// see the freshly-applied tag/status there. Heroes and the
				// fellowship singleton are added automatically; placed-token
				// challenges and journeys are not, and the rote consequence is
				// most often what first puts a status on them.
				if (actor) await ApplyActionMenuApp.#ensureActorInSidebar(actor);

				await foundry.documents.ChatMessage.create({
					speaker: { alias: game.user.name },
					content: await foundry.applications.handlebars.renderTemplate(
						"systems/litmv2/templates/chat/action-applied.html",
						{
							actorImg: actor?.img,
							// publicName so the stored card never reveals a concealed
							// challenge's real name, even when the GM generates it
							actorName: actor?.system.publicName ?? actor?.name,
							label: t("LITM.Terms.consequences"),
							summary: stripActorPrefix(
								result.appliedSummary,
								actor?.system.publicName ?? actor?.name,
							),
							footer: action.name,
							reactActorId: actor?.id ?? null,
						},
					),
				});
			}
			if (appliedAny) newlyApplied.push(index);
		}

		// Record for the ✓ marker in one write after the loop; dedupe since
		// re-application is allowed.
		if (newlyApplied.length) {
			const appliedNow = message.getFlag("litmv2", "appliedConsequences") ?? [];
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
		const sidebar = getStoryTagSidebar();
		const config = sidebar?.config ?? LitmSettings.storyTags ?? {};
		const existing = config.actors ?? [];
		if (existing.includes(actor.uuid)) return;
		await LitmSettings.setStoryTags({
			...config,
			actors: [...existing, actor.uuid],
		});
		sidebar?.invalidateCache();
		sidebar?.render();
	}
}
