import { WelcomeOverlay } from "../../apps/welcome-overlay.js";
import { localize as t } from "../../utils.js";
import { Sockets } from "../sockets.js";

export function registerChatHooks() {
	Hooks.on("renderChatMessageHTML", onRenderChatMessage);
	_attachContextMenuToRollMessage();
	_registerChatCommands();
}

export function onRenderChatMessage(app, html, _data) {
	const element = html[0] ?? html;

	// Attach GM indicator
	element.setAttribute("data-user", game.user.isGM ? "gm" : "player");

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

	// Remove empty footer if no buttons remain
	const footer = element.querySelector(".dice-footer");
	if (footer && footer.querySelectorAll("button").length === 0) {
		footer.remove();
	}

	// Chat message listeners
	const clickables = element.querySelectorAll("[data-click]");
	for (const target of clickables) {
		target.addEventListener("click", async (event) => {
			event.stopPropagation();
			event.preventDefault();

			const { click } = target.dataset;

			switch (click) {
				case "spend-power": {
					const messageId = target.closest(".chat-message").dataset.messageId;
					const message = game.messages.get(messageId);
					const roll = message.rolls[0];
					const power = roll.power;
					const actorId = roll.litm?.actorId;

					new game.litmv2.SpendPowerApp({ actorId, power, messageId }).render(
						true,
					);
					break;
				}
				case "push-roll": {
					const messageId = target.closest(".chat-message").dataset.messageId;
					const message = game.messages.get(messageId);
					const roll = message.rolls[0];
					roll.options.pushed = true;
					await message.update({ rolls: [roll] });
					break;
				}
				case "approve-moderation": {
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
					break;
				}
				case "complete-sacrifice": {
					const messageId = target.closest(".chat-message").dataset.messageId;
					const message = game.messages.get(messageId);
					const roll = message.rolls[0];
					const { sacrificeLevel, sacrificeThemeId, actorId } = roll.litm;
					const actor = game.actors.get(actorId);
					const theme = actor?.items?.get(sacrificeThemeId);
					if (!theme || !actor) break;

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
					if (!confirmed) break;

					await _applySacrificeConsequence(
						actor,
						sacrificeLevel,
						sacrificeThemeId,
					);

					// Mark sacrifice as completed so button disappears
					roll.options.sacrificeCompleted = true;
					await message.update({ rolls: [roll] });
					break;
				}
				case "reject-moderation": {
					const data = await app.getFlag("litmv2", "data");
					// Delete Message
					app.delete();
					// Reopen Roll Dialog
					const actor = game.actors.get(data.actorId);
					actor?.sheet?.renderRollDialog();
					ui.notifications.warn(
						game.i18n.format("LITM.Ui.roll_rejected", {
							name: t("You"),
						}),
					);
					// Dispatch order to reopen
					Sockets.dispatch("rejectRoll", {
						name: game.user.name,
						actorId: data.actorId,
					});
					break;
				}
				case "open-theme-advancement": {
					const { actorId, themeId } = target.dataset;
					if (!actorId || !themeId) return;
					new game.litmv2.ThemeAdvancementApp({ actorId, themeId }).render(
						true,
					);
					break;
				}
			}
		});
	}
}

async function _applySacrificeConsequence(actor, level, themeId) {
	const theme = actor.items.get(themeId);
	if (!theme) return;
	const themeName = theme.name;

	if (level === "painful") {
		// Scratch all power tags and the theme tag
		const raw = theme.system.toObject();
		const isStoryTheme = theme.type === "story_theme";
		const powerTags = isStoryTheme ? raw.theme.powerTags : raw.powerTags;
		const systemPath = isStoryTheme
			? "system.theme.powerTags"
			: "system.powerTags";
		for (const tag of powerTags) {
			tag.isScratched = true;
		}
		await actor.updateEmbeddedDocuments("Item", [
			{
				_id: theme.id,
				[systemPath]: powerTags,
				"system.isScratched": true,
			},
		]);
		ui.notifications.info(
			game.i18n.format("LITM.Ui.sacrifice_theme_scratched", {
				theme: themeName,
			}),
		);
	} else if (level === "scarring") {
		// Remove the theme entirely
		await actor.deleteEmbeddedDocuments("Item", [theme.id]);
		ui.notifications.info(
			game.i18n.format("LITM.Ui.sacrifice_theme_removed", {
				theme: themeName,
			}),
		);
	}
}

function _registerChatCommands() {
	const commands = {
		hero: {
			rgx: /^\/hero\s*$/i,
			handler: () => WelcomeOverlay.showFromCommand("modeSelect"),
		},
		welcome: {
			rgx: /^\/welcome\s*$/i,
			handler: () => WelcomeOverlay.showFromCommand("welcome"),
		},
	};

	Hooks.once("ready", () => {
		const ChatLogClass = ui.chat.constructor;

		// V14+: Register via CHAT_COMMANDS API
		if ("CHAT_COMMANDS" in ChatLogClass) {
			for (const [name, { handler }] of Object.entries(commands)) {
				ChatLogClass.CHAT_COMMANDS[name] = {
					rgx: new RegExp(`^(/${name})\\s*$`, "i"),
					fn: () => {
						handler();
						return false;
					},
				};
			}
		}
		// V13: Intercept via chatMessage hook before the parser rejects them
		else {
			Hooks.on("chatMessage", (_chatLog, message) => {
				const trimmed = message.trim();
				for (const { rgx, handler } of Object.values(commands)) {
					if (rgx.test(trimmed)) {
						handler();
						return false;
					}
				}
			});
		}
	});
}

function _attachContextMenuToRollMessage() {
	const callback = (_, options) => {
		// Add context menu option to change roll types
		const createTypeChange = (type) => ({
			label: `${t("LITM.Ui.change_roll_type")}: ${t(`LITM.Ui.roll_${type}`)}`,
			icon: "fas fa-dice",
			visible: (li) => {
				return (
					!!li.querySelector(".litm.dice-roll[data-type]") &&
					!li.querySelector(`[data-type='${type}']`)
				);
			},
			onClick: (_event, li) => {
				const message = game.messages.get(li.dataset.messageId);
				const roll = message.rolls[0];
				roll.options.type = type;
				message.update({ rolls: [roll] });
			},
		});

		options.unshift(
			...["quick", "tracked", "mitigate", "sacrifice"].map(createTypeChange),
		);
	};
	Hooks.on("getChatMessageContextOptions", callback);
}
