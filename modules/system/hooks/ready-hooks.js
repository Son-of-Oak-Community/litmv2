import { WelcomeOverlay } from "../../apps/welcome/welcome-overlay.js";
import { CallForRollHud } from "../../hud/call-for-roll-hud.js";
import { RollDialogHud } from "../../hud/roll-dialog-hud.js";
import { error } from "../../logger.js";
import { getStoryTagSidebar } from "../../utils.js";
import { FLAGS } from "../config.js";
import { LitmSettings } from "../settings.js";
import { registerTours } from "../tours.js";
import { bootstrapWorldOnFirstLoad } from "../world-setup.js";

export function registerReadyHooks() {
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

// `heroLimit` / `themeLimit` used to be seeded here, on `ready`. They are now
// seeded at registration time (init) in `LitmSettings.register()`, because
// document data preparation reads them *before* `ready` — `heroLimit` drives
// both the hero's limit readout and the status track depth
// (`CONFIG.litmv2.maxStatusTier`). Re-seeding on ready would also stomp a
// module that overrode either value during init.

function _setupRollDialogHud() {
	Hooks.once("ready", async () => {
		const hud = new RollDialogHud();
		game.litmv2.rollDialogHud = hud;
		// The Narrator's own control shares the region with the strip. Held on
		// game.litmv2 for the same reason the strip is: a module may want to
		// re-render or replace it.
		const callHud = new CallForRollHud();
		game.litmv2.callForRollHud = callHud;

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
		callHud.render();
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
