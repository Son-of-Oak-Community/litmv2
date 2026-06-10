import { WelcomeOverlay } from "../../apps/welcome/welcome-overlay.js";
import { RollDialogHud } from "../../hud/roll-dialog-hud.js";
import { error } from "../../logger.js";
import { getStoryTagSidebar } from "../../utils.js";
import { FLAGS } from "../config.js";
import { LitmSettings } from "../settings.js";
import { registerTours } from "../tours.js";
import { bootstrapWorldOnFirstLoad } from "../world-setup.js";

export function registerReadyHooks() {
	_seedConfigFromSettings();
	_setupRollDialogHud();
	_renderWelcomeScreen();
	_popoutTagsSidebar();
	_applyColorblindMode();
	Hooks.once("ready", registerTours);
}

function _applyColorblindMode() {
	Hooks.once("ready", () => {
		document.body.classList.toggle(
			"litm--colorblind",
			!!LitmSettings.colorblindMode,
		);
	});
}

function _seedConfigFromSettings() {
	Hooks.once("ready", () => {
		CONFIG.litmv2.heroLimit = LitmSettings.heroLimit;
		CONFIG.litmv2.themeLimit = LitmSettings.themeLimit;
	});
}

function _setupRollDialogHud() {
	Hooks.once("ready", async () => {
		const hud = new RollDialogHud();
		game.litmv2.rollDialogHud = hud;

		const unsetPromises = [];
		for (const actor of game.actors) {
			const flag = actor.getFlag("litmv2", FLAGS.rollDialogOwner);
			if (!flag) continue;
			const isOwnFlag = flag.ownerId === game.user.id;
			const isDisconnectedUser = !game.users.get(flag.ownerId)?.active;
			if (isOwnFlag || (game.user.isGM && isDisconnectedUser)) {
				unsetPromises.push(actor.unsetFlag("litmv2", FLAGS.rollDialogOwner));
			}
		}
		await Promise.all(unsetPromises);
		hud.render();
	});
}

function _popoutTagsSidebar() {
	Hooks.once("ready", () => {
		if (LitmSettings.popoutTagsSidebar) getStoryTagSidebar()?.renderPopout();
	});
}

function _renderWelcomeScreen() {
	Hooks.once("ready", async () => {
		try {
			if (!LitmSettings.welcomed && game.user.isGM) {
				await bootstrapWorldOnFirstLoad();
			}
			await WelcomeOverlay.showOnReady();
		} catch (err) {
			error("Failed to show welcome overlay", err);
		}
	});
}
