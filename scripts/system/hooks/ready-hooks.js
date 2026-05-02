import { WelcomeOverlay } from "../../apps/welcome-overlay.js";
import { RollDialogHud } from "../../hud/roll-dialog-hud.js";
import { error } from "../../logger.js";
import { getStoryTagSidebar } from "../../utils.js";
import { LitmSettings } from "../settings.js";
import { registerTours } from "../tours.js";

export function registerReadyHooks() {
	_setupRollDialogHud();
	_renderWelcomeScreen();
	_listenToTagDragTransfer();
	_popoutTagsSidebar();
	Hooks.once("ready", registerTours);
}

function _setupRollDialogHud() {
	Hooks.once("ready", async () => {
		const hud = new RollDialogHud();
		game.litmv2.rollDialogHud = hud;

		const unsetPromises = [];
		for (const actor of game.actors) {
			const flag = actor.getFlag("litmv2", "rollDialogOwner");
			if (!flag) continue;
			const isOwnFlag = flag.ownerId === game.user.id;
			const isDisconnectedUser = !game.users.get(flag.ownerId)?.active;
			if (isOwnFlag || (game.user.isGM && isDisconnectedUser)) {
				unsetPromises.push(actor.unsetFlag("litmv2", "rollDialogOwner"));
			}
		}
		await Promise.all(unsetPromises);
		hud.render();
	});

	Hooks.on("renderPlayers", () => {
		game.litmv2.rollDialogHud?.render?.();
	});

	Hooks.on("updateActor", (actor) => {
		if (actor.type !== "hero") return;
		game.litmv2.rollDialogHud?.render?.();
	});
}

function _listenToTagDragTransfer() {
	Hooks.on("ready", () => {
		document.addEventListener("dragstart", (event) => {
			const target = event.target.closest(
				".litm--tag, .litm--status, .litm-tag, .litm-status, .litm-limit",
			);
			if (!target) return;

			const text = target.dataset.text || target.textContent;
			const matches = `{${text}}`.matchAll(CONFIG.litmv2.tagStringRe);
			const match = [...matches][0];
			if (!match) return;

			const [, name, separator, value] = match;
			const isStatus = separator === "-" && !target.classList.contains("litm-limit");
			const isLimit = separator === ":" || name.startsWith("-") || target.classList.contains("litm-limit");
			const cleanName = name.replace(/^-/, "");
			const appEl = target.closest(".sheet");
			const app = appEl ? foundry.applications.instances.get(appEl.id) : null;
			const sourceActorId = app?.document?.id ?? null;
			const data = {
				id: foundry.utils.randomID(),
				name: isLimit ? cleanName : name,
				type: isStatus ? "status_tag" : isLimit ? "limit" : "story_tag",
				values: Array(6)
					.fill(null)
					.map((_, i) => (Number.parseInt(value, 10) === i + 1 ? value : null)),
				isScratched: false,
				value: value,
				sourceActorId,
			};
			event.dataTransfer.setData("text/plain", JSON.stringify(data));
		});
	});
}

function _popoutTagsSidebar() {
	Hooks.once("ready", () => {
		if (LitmSettings.popoutTagsSidebar) getStoryTagSidebar()?.renderPopout();
	});
}

function _renderWelcomeScreen() {
	Hooks.once("ready", () => {
		WelcomeOverlay.showOnReady().catch((err) =>
			error("Failed to show welcome overlay", err),
		);
	});
}
