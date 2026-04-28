import { enrichHTML, localize as t } from "../utils.js";
import { error } from "../logger.js";
import { applyConsequence } from "../system/chat-actions.js";
import { stripActorPrefix } from "./spend-power.js";

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
		const applied = new Set(message.getFlag("litmv2", "appliedConsequences") ?? []);
		const items = await Promise.all((sys.consequences ?? []).map(async (text, index) => ({
			key: String(index),
			text: await enrichHTML(text, action),
			applied: applied.has(index),
			disabled: applied.has(index),
		})));

		return {
			actionName: action.name,
			items,
			empty: items.length === 0,
		};
	}

	static async #onSubmit(_event, form, _formData) {
		const message = this._getMessage();
		const action = await this._getAction();
		if (!message || !action) return;

		if (!game.user.isGM) {
			ui.notifications.info(t("LITM.Actions.gm_only"));
			return;
		}

		const checkedKeys = Array.from(
			form.querySelectorAll("input[name='option']:checked"),
		).map((el) => el.value);
		if (!checkedKeys.length) return;

		const actorId = message.rolls?.[0]?.litm?.actorId
			?? message.speaker?.actor
			?? null;
		const actor = actorId ? game.actors.get(actorId) : null;

		for (const key of checkedKeys) {
			const index = Number(key);
			if (!Number.isFinite(index)) continue;
			const text = (action.system.consequences ?? [])[index];
			if (!text) continue;

			const appliedNow = message.getFlag("litmv2", "appliedConsequences") ?? [];
			if (appliedNow.includes(index)) continue;

			let result;
			try {
				result = await applyConsequence({ text, actor });
			} catch (err) {
				error("Failed to apply consequence:", err);
				ui.notifications.error(t("LITM.Actions.apply_failed"));
				continue;
			}
			if (!result) continue;

			await message.setFlag("litmv2", "appliedConsequences", [...appliedNow, index]);
			await foundry.documents.ChatMessage.create({
				speaker: { alias: game.user.name },
				content: await foundry.applications.handlebars.renderTemplate(
					"systems/litmv2/templates/chat/action-applied.html",
					{
						actorImg: actor?.img,
						actorName: actor?.name,
						label: t("LITM.Terms.consequences"),
						summary: stripActorPrefix(result.appliedSummary, actor?.name),
						footer: action.name,
					},
				),
			});
		}
	}
}
