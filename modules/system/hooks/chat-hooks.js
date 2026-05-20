import { ApplyActionMenuApp } from "../../apps/apply-action-menu.js";
import { LitmRollDialog } from "../../apps/roll/roll-dialog.js";
import { SpendPowerApp } from "../../apps/spend-power.js";
import { ThemeAdvancementApp } from "../../apps/theme-advancement.js";
import { ThemeEvolutionWizard } from "../../apps/theme-evolution.js";
import { WelcomeOverlay } from "../../apps/welcome/welcome-overlay.js";
import {
	getAllowedVerbs,
	getSuccessCost,
} from "../../item/action/action-rules.js";
import { getVerbDef } from "../../item/action/verb-definitions.js";
import { localize as t, viewLinkedRefAction } from "../../utils.js";
import { buildTrackCompleteContent } from "../chat.js";
import { POWER_TAG_TYPES } from "../config.js";
import { Sockets } from "../sockets.js";

/**
 * Apply the consequence of a sacrifice roll to a hero's theme.
 * Performs document mutations only; notifications are shown by the caller.
 * @param {Actor} actor - The hero actor
 * @param {string} themeId - The sacrificed theme's ID
 * @param {string} level - "painful" or "scarring"
 * @returns {Promise<{themeName: string}|null>} The theme name for notification, or null if not found
 */
async function applyThemeSacrifice(actor, themeId, level) {
	const theme = actor.items.get(themeId);
	if (!theme) return null;
	const themeName = theme.name;

	if (level === "painful") {
		const powerEffects = theme.effects.filter((e) =>
			POWER_TAG_TYPES.has(e.type),
		);
		if (powerEffects.length) {
			await theme.updateEmbeddedDocuments(
				"ActiveEffect",
				powerEffects.map((e) => ({ _id: e.id, "system.isScratched": true })),
			);
		}
		await actor.updateEmbeddedDocuments("Item", [
			{ _id: theme.id, "system.isScratched": true },
		]);
	} else if (level === "scarring") {
		await actor.deleteEmbeddedDocuments("Item", [theme.id]);
	}

	return { themeName };
}

export function registerChatHooks() {
	Hooks.on("renderChatMessageHTML", onRenderChatMessage);
	Hooks.on("litm.trackCompleted", _onTrackCompleted);
	Hooks.on("litm.limitReached", _onLimitReached);
	_attachContextMenuToRollMessage();
	_registerChatCommands();
}

async function _onTrackCompleted({ actor, trackInfo }) {
	await foundry.documents.ChatMessage.create({
		content: await buildTrackCompleteContent(trackInfo),
		speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
	});
}

async function _onLimitReached({ actor, limit }) {
	const text = limit.outcome
		? game.i18n.format("LITM.Ui.limit_reached_with_outcome", {
				label: limit.label,
				actor: actor.name,
				outcome: limit.outcome,
			})
		: game.i18n.format("LITM.Ui.limit_reached", {
				label: limit.label,
			});

	await foundry.documents.ChatMessage.create({
		content: await buildTrackCompleteContent({ text, type: "limit" }),
		whisper: foundry.documents.ChatMessage.getWhisperRecipients("GM"),
		speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
	});
}

function _getMessageAndRoll(target) {
	const messageId = target.closest(".chat-message").dataset.messageId;
	const message = game.messages.get(messageId);
	const roll = message.rolls[0];
	return { message, roll };
}

async function _handleSpendPower(target) {
	const { message, roll } = _getMessageAndRoll(target);
	const power = roll.power;
	const actorId = roll.litm?.actorId;

	new SpendPowerApp({
		actorId,
		power,
		messageId: message.id,
	}).render(true);
}

async function _handlePushRoll(target) {
	const { message, roll } = _getMessageAndRoll(target);
	if (!message.isAuthor && !game.user.isGM) return;
	roll.options.pushed = true;
	await message.update({ rolls: [roll.toJSON()] });
}

async function _handleApproveModeration(_target, app) {
	if (!game.user.isGM) return;
	const data = await app.getFlag("litmv2", "data");
	const userId = await app.getFlag("litmv2", "userId");

	// Delete Message
	app.delete();

	// Roll
	if (userId === game.userId) {
		LitmRollDialog.roll(data);
		// Reset own roll dialog locally (sockets don't echo to sender)
		const actor = game.actors.get(data.actorId);
		if (actor?.sheet?.rendered) actor.sheet.resetRollDialog();
	} else {
		Sockets.dispatch("rollDice", {
			userId,
			data,
		});
	}

	// Dispatch order to reset Roll Dialog on other clients
	Sockets.dispatch("resetRollDialog", {
		actorId: data.actorId,
	});
}

async function _handleCompleteSacrifice(target) {
	const { message, roll } = _getMessageAndRoll(target);
	const { sacrificeLevel, sacrificeThemeId, actorId } = roll.litm;
	const actor = game.actors.get(actorId);
	if (!actor?.isOwner) return;
	const theme = actor.items?.get(sacrificeThemeId);
	if (!theme) return;

	const confirmKey =
		sacrificeLevel === "scarring"
			? "LITM.Ui.sacrifice_confirm_scarring"
			: "LITM.Ui.sacrifice_confirm_painful";

	const confirmed = await foundry.applications.api.DialogV2.confirm({
		window: {
			title: t("LITM.Ui.sacrifice_confirm_title"),
		},
		content: `<p>${game.i18n.format(confirmKey, { theme: theme.name })}</p>`,
		rejectClose: false,
		modal: true,
	});
	if (!confirmed) return;

	const result = await applyThemeSacrifice(
		actor,
		sacrificeThemeId,
		sacrificeLevel,
	);
	if (result) {
		const notifKey =
			sacrificeLevel === "scarring"
				? "LITM.Ui.sacrifice_theme_removed"
				: "LITM.Ui.sacrifice_theme_scratched";
		ui.notifications.info(
			game.i18n.format(notifKey, { theme: result.themeName }),
		);
	}

	// Mark sacrifice as completed so button disappears
	roll.options.sacrificeCompleted = true;
	await message.update({ rolls: [roll.toJSON()] });
}

async function _handleRejectModeration(_target, app) {
	if (!game.user.isGM) return;
	const data = await app.getFlag("litmv2", "data");
	// Delete Message
	app.delete();
	// Dispatch order to reopen
	Sockets.dispatch("rejectRoll", {
		name: game.user.name,
		actorId: data.actorId,
	});
}

async function _handleOpenThemeAdvancement(target) {
	const { actorId, themeId } = target.dataset;
	if (!actorId || !themeId) return;
	new ThemeAdvancementApp({ actorId, themeId }).render(true);
}

async function _handleOpenThemeEvolution(target) {
	const { actorId, themeId } = target.dataset;
	if (!actorId || !themeId) return;
	const messageId = target.closest(".chat-message")?.dataset.messageId;
	const Wizard = game.litmv2?.ThemeEvolutionWizard ?? ThemeEvolutionWizard;
	new Wizard({ actorId, themeId, messageId }).render(true);
}

function _handleViewActionRef(target) {
	return viewLinkedRefAction(null, target);
}

function _handleOpenApplyConsequences(_target, app) {
	if (!game.user.isGM) {
		ui.notifications.info(t("LITM.Actions.gm_only"));
		return;
	}
	new ApplyActionMenuApp({ messageId: app.id, mode: "consequences" }).render(
		true,
	);
}

async function _handleReact(target) {
	const actorId = target.dataset.actorId;
	if (!actorId) return;
	const actor = game.actors.get(actorId);
	if (!actor) {
		ui.notifications.warn(t("LITM.Actions.apply_no_actor"));
		return;
	}
	if (!actor.isOwner && !game.user.isGM) {
		ui.notifications.warn(t("LITM.Actions.request_not_owner"));
		return;
	}

	const sheet = actor.sheet;
	const dialog = sheet?.rollDialogInstance;
	if (!dialog) return;
	dialog.setType("mitigate");
	if (typeof sheet.renderRollDialog === "function") sheet.renderRollDialog();
	else if (!dialog.rendered) dialog.render(true);
}

async function _handleTakeRollRequest(_target, app) {
	const req = app.getFlag("litmv2", "rollRequest");
	if (!req?.actionUuid || !req?.requestedActorId) return;

	const actor = game.actors.get(req.requestedActorId);
	if (!actor) {
		ui.notifications.warn(t("LITM.Actions.apply_no_actor"));
		return;
	}
	if (!actor.isOwner && !game.user.isGM) {
		ui.notifications.warn(t("LITM.Actions.request_not_owner"));
		return;
	}

	const sheet = actor.sheet;
	const dialog = sheet?.rollDialogInstance;
	if (!dialog) return;
	dialog.setAction(req.actionUuid);
	if (typeof sheet.renderRollDialog === "function") sheet.renderRollDialog();
	else if (!dialog.rendered) dialog.render(true);
}

const CLICK_HANDLERS = {
	"spend-power": _handleSpendPower,
	"push-roll": _handlePushRoll,
	"approve-moderation": _handleApproveModeration,
	"complete-sacrifice": _handleCompleteSacrifice,
	"reject-moderation": _handleRejectModeration,
	"open-theme-advancement": _handleOpenThemeAdvancement,
	"open-theme-evolution": _handleOpenThemeEvolution,
	"action-view-ref": _handleViewActionRef,
	"action-open-consequences": _handleOpenApplyConsequences,
	"take-roll-request": _handleTakeRollRequest,
	react: _handleReact,
};

async function _renderActionSuccesses(app, element) {
	const actionUuid = app.getFlag("litmv2", "actionUuid");
	if (!actionUuid) return;

	const roll = app.rolls?.[0];
	if (!roll) return;

	const allowedVerbs = getAllowedVerbs(roll);
	if (!allowedVerbs.size) return;

	const action = await foundry.utils.fromUuid(actionUuid);
	if (!action || action.type !== "action") return;

	const reachable = (action.system.successes ?? []).filter((s) =>
		allowedVerbs.has(s.verb),
	);
	if (!reachable.length) return;

	const successes = reachable.map((s) => {
		const cost = getSuccessCost(s);
		const def = getVerbDef(s.verb);
		return {
			verb: s.verb,
			verbLabel: t(`LITM.Actions.verbs.${s.verb}`),
			text: s.text,
			costLabel: _costLabel(cost, def),
		};
	});

	const html = await foundry.applications.handlebars.renderTemplate(
		"systems/litmv2/templates/partials/action-quick-successes.html",
		{ successes },
	);

	const wrapper = document.createElement("div");
	wrapper.innerHTML = html.trim();
	const node = wrapper.firstElementChild;
	if (!node) return;

	const details = element.querySelector(".litm.dice-roll .dice-result-details");
	const effect = details?.querySelector(".dice-effect");
	if (effect) {
		effect.insertAdjacentElement("afterend", node);
	} else if (details) {
		details.appendChild(node);
	}
}

/**
 * Build the inline cost indicator next to a success on the chat card.
 * Narrative (Quick) verbs are free → no label. Verbs with variable-tier
 * tokens show e.g. "2+ Power" because the tier is picked in Spend Power.
 */
function _costLabel(cost, def) {
	if (!def || def.kind === "narrative") return "";
	const fixed = cost.fixed ?? 0;
	const variable = cost.variableTokens ?? 0;
	if (variable > 0)
		return game.i18n.format("LITM.Actions.cost_variable", { n: fixed });
	if (fixed <= 0) return "";
	return game.i18n.format("LITM.Actions.cost", { n: fixed });
}

async function _renderActionPanel(app, element) {
	if (!game.user.isGM) return;
	const actionUuid = app.getFlag("litmv2", "actionUuid");
	if (!actionUuid) return;

	// Consequences are only dealt on Miss or Success-with-Consequences. A
	// clean Success (10+) carries no Consequences — the button shouldn't
	// appear there (Core Book p.151). Reactions are pre-roll mitigation;
	// they don't surface the action's own Consequences either.
	const roll = app.rolls?.[0];
	const outcome = roll?.outcome?.label;
	if (!outcome || outcome === "success") return;
	if (roll?.litm?.type === "mitigate") return;

	const action = await foundry.utils.fromUuid(actionUuid);
	if (!action || action.type !== "action") return;

	const sys = action.system;
	const totalConsequences = sys.consequences?.length ?? 0;
	if (totalConsequences === 0) return;

	const appliedConsequences = new Set(
		app.getFlag("litmv2", "appliedConsequences") ?? [],
	);
	const unappliedConsequences =
		totalConsequences -
		[...appliedConsequences].filter((i) => i < totalConsequences).length;

	const html = await foundry.applications.handlebars.renderTemplate(
		"systems/litmv2/templates/partials/action-success-buttons.html",
		{
			actionContext: {
				showApplyConsequences: true,
				unappliedConsequences,
			},
		},
	);

	const wrapper = document.createElement("div");
	wrapper.innerHTML = html.trim();
	const node = wrapper.firstElementChild;
	if (!node) return;

	// Inject alongside Spend Power inside the existing .dice-footer so all
	// post-roll actions live in one row.
	const diceFooter = element.querySelector(".litm.dice-roll .dice-footer");
	if (diceFooter) {
		diceFooter.appendChild(node);
	} else {
		// Fallback: dice-roll exists but footer wasn't rendered (eg. when
		// canSpendPower was false and Push Your Luck didn't apply either).
		// Build a footer ourselves.
		const diceRoll = element.querySelector(".litm.dice-roll");
		if (!diceRoll) return;
		const footer = document.createElement("footer");
		footer.className = "dice-footer flexrow";
		footer.appendChild(node);
		diceRoll.appendChild(footer);
	}
}

function onRenderChatMessage(app, html, _data) {
	const element = html;

	// Attach GM indicator
	element.setAttribute("data-user", game.user.isGM ? "gm" : "player");

	_renderActionSuccesses(app, element).catch((e) =>
		console.error("LITM action successes render failed:", e),
	);
	_renderActionPanel(app, element).catch((e) =>
		console.error("LITM action panel render failed:", e),
	);

	// Add class if it's a litm dice roll
	if (element.querySelector(".litm.dice-roll")) {
		element.classList.add("litm-dice-roll-message");
	}

	// Hide spend-power button if all power has been spent
	const spendBtn = element.querySelector("[data-click='spend-power']");
	if (spendBtn) {
		const spentPower = app.getFlag("litmv2", "spentPower") ?? 0;
		const roll = app.rolls?.[0];
		if (roll && spentPower >= roll.power) {
			spendBtn.remove();
		}
	}

	// Hide complete-sacrifice button if already completed
	const sacrificeBtn = element.querySelector(
		"[data-click='complete-sacrifice']",
	);
	if (sacrificeBtn) {
		const roll = app.rolls?.[0];
		if (roll?.litm?.sacrificeCompleted) {
			sacrificeBtn.remove();
		}
	}

	// Hide theme advancement / evolution buttons for non-owners
	for (const click of ["open-theme-advancement", "open-theme-evolution"]) {
		const btn = element.querySelector(`[data-click='${click}']`);
		if (btn && !app.isAuthor)
			btn.closest(".litm-track-complete__footer")?.remove();
	}

	// Hide the evolution button once the wizard has resolved this card so
	// the same chat message can't open the wizard a second time.
	const evolveBtn = element.querySelector(
		"[data-click='open-theme-evolution']",
	);
	if (evolveBtn && app.getFlag("litmv2", "evolutionResolved")) {
		evolveBtn.closest(".litm-track-complete__footer")?.remove();
	}

	// Hide react button from users who don't own the target actor
	const reactBtn = element.querySelector("[data-click='react']");
	if (reactBtn) {
		const actor = game.actors.get(reactBtn.dataset.actorId);
		if (!actor || (!actor.isOwner && !game.user.isGM)) {
			reactBtn.closest(".litm-spend-chat__react")?.remove();
		}
	}

	// Moderation messages: show actions only to GMs, toggle hint text
	const moderationActions = element.querySelector(".litm--moderation-actions");
	if (moderationActions) {
		if (!game.user.isGM) moderationActions.remove();
		const gmHint = element.querySelector(".litm--moderation-gm-hint");
		const playerHint = element.querySelector(".litm--moderation-player-hint");
		if (game.user.isGM) playerHint?.remove();
		else gmHint?.remove();
	}

	// Remove empty footer if no buttons remain
	const footer = element.querySelector(".dice-footer");
	if (footer && footer.querySelectorAll("button").length === 0) {
		footer.remove();
	}

	// Delegated click handler — survives async DOM appends (e.g. _renderActionPanel).
	element.addEventListener("click", async (event) => {
		const target = event.target.closest?.("[data-click]");
		if (!target || !element.contains(target)) return;
		const handler = CLICK_HANDLERS[target.dataset.click];
		if (!handler) return;
		event.stopPropagation();
		event.preventDefault();
		await handler(target, app);
	});
}

function _registerChatCommands() {
	const commands = {
		hero: {
			handler: () => WelcomeOverlay.showFromCommand("modeSelect"),
		},
		welcome: {
			handler: () => WelcomeOverlay.showFromCommand("welcome"),
		},
	};

	Hooks.once("ready", () => {
		const ChatLogClass = ui.chat.constructor;

		for (const [name, { handler }] of Object.entries(commands)) {
			ChatLogClass.CHAT_COMMANDS[name] = {
				rgx: new RegExp(`^(/${name})\\s*$`, "i"),
				fn: () => {
					handler();
					return false;
				},
			};
		}
	});
}

function _attachContextMenuToRollMessage() {
	const callback = (_, options) => {
		// Add context menu option to change roll types
		const createTypeChange = (type) => {
			const label = `${t("LITM.Ui.change_roll_type")}: ${t(`LITM.Ui.roll_${type}`)}`;
			const isVisible = (li) => {
				return (
					!!li.querySelector(".litm.dice-roll[data-type]") &&
					!li.querySelector(`[data-type='${type}']`)
				);
			};
			const handler = (_event, li) => {
				const message = game.messages.get(li.dataset.messageId);
				const roll = message.rolls[0];
				roll.options.type = type;
				message.update({ rolls: [roll.toJSON()] });
			};
			return {
				label,
				icon: '<i class="fas fa-dice"></i>',
				visible: isVisible,
				onClick: handler,
			};
		};

		options.unshift(...["quick", "tracked", "mitigate"].map(createTypeChange));
	};
	Hooks.on("getChatMessageContextOptions", callback);
}
