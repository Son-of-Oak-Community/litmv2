import { WelcomeOverlay } from "../../apps/welcome-overlay.js";
import { ApplyActionMenuApp } from "../../apps/apply-action-menu.js";
import { applyThemeSacrifice } from "../../actor/hero/hero-data.js";
import { getAllowedQualities } from "../../item/action/action-rules.js";
import { enrichHTML, localize as t, viewLinkedRefAction } from "../../utils.js";
import { Sockets } from "../sockets.js";

export function registerChatHooks() {
	Hooks.on("renderChatMessageHTML", onRenderChatMessage);
	_attachContextMenuToRollMessage();
	_registerChatCommands();
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

	new game.litmv2.SpendPowerApp({ actorId, power, messageId: message.id }).render(
		true,
	);
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
		game.litmv2.LitmRollDialog.roll(data);
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

	await applyThemeSacrifice(actor, sacrificeThemeId, sacrificeLevel);

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
	new game.litmv2.ThemeAdvancementApp({ actorId, themeId }).render(
		true,
	);
}

function _handleViewActionRef(target) {
	return viewLinkedRefAction(null, target);
}

function _handleOpenApplyConsequences(_target, app) {
	if (!game.user.isGM) {
		ui.notifications.info(t("LITM.Actions.gm_only"));
		return;
	}
	new ApplyActionMenuApp({ messageId: app.id, mode: "consequences" }).render(true);
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
	"action-view-ref": _handleViewActionRef,
	"action-open-consequences": _handleOpenApplyConsequences,
	"take-roll-request": _handleTakeRollRequest,
};

async function _renderActionQuickSuccesses(app, element) {
	const actionUuid = app.getFlag("litmv2", "actionUuid");
	if (!actionUuid) return;

	const roll = app.rolls?.[0];
	if (!roll) return;

	const allowedQualities = getAllowedQualities(roll);
	if (!allowedQualities.has("quick")) return;

	const action = await foundry.utils.fromUuid(actionUuid);
	if (!action || action.type !== "action") return;

	const quickSuccesses = (action.system.successes ?? [])
		.filter((s) => s.quality === "quick");
	if (!quickSuccesses.length) return;

	const successes = await Promise.all(
		quickSuccesses.map(async (s) => ({
			verbLabel: t(`LITM.Actions.verbs.${s.verb}`),
			label: s.label,
			description: s.description ? await enrichHTML(s.description, action) : "",
		})),
	);

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

async function _renderActionPanel(app, element) {
	if (!game.user.isGM) return;
	const actionUuid = app.getFlag("litmv2", "actionUuid");
	if (!actionUuid) return;

	const action = await foundry.utils.fromUuid(actionUuid);
	if (!action || action.type !== "action") return;

	const sys = action.system;
	const totalConsequences = sys.consequences?.length ?? 0;
	if (totalConsequences === 0) return;

	const appliedConsequences = new Set(app.getFlag("litmv2", "appliedConsequences") ?? []);
	const unappliedConsequences = totalConsequences
		- [...appliedConsequences].filter((i) => i < totalConsequences).length;

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

	_renderActionQuickSuccesses(app, element).catch((e) => console.error("LITM quick successes render failed:", e));
	_renderActionPanel(app, element).catch((e) => console.error("LITM action panel render failed:", e));

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

	// Hide theme advancement button for non-owners
	const advanceBtn = element.querySelector(
		"[data-click='open-theme-advancement']",
	);
	if (advanceBtn && !app.isAuthor)
		advanceBtn.closest(".litm-track-complete__footer")?.remove();

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
