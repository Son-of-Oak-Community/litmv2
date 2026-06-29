import { scratchTag } from "../active-effects/scratchable-mixin.js";
import { LitmRollDialog } from "../apps/roll/roll-dialog.js";
import { error, warn } from "../logger.js";
import { getStoryTagSidebar } from "../utils.js";

export class Sockets {
	static dispatch(event, data) {
		if (!game.ready) {
			return error(
				`Tried to dispatch ${event} socket event before the game was ready.`,
			);
		}

		const senderId = game.user.id;
		const id = foundry.utils.randomID();
		game.socket.emit("system.litmv2", {
			id,
			data,
			event,
			senderId,
		});
	}

	static #bound = false;

	static on(event, cb) {
		Hooks.on(`litm.socket.${event}`, cb);
		if (this.#bound) return;
		this.#bound = true;
		game.socket.on("system.litmv2", (data) => {
			const { event: e, senderId, ...d } = data;
			if (senderId === game.userId) return;
			Hooks.callAll(`litm.socket.${e}`, d);
		});
	}

	static registerListeners() {
		this.#registerRollUpdateListener();
		this.#registerRollModerationListeners();
		this.#registerStoryTagsListeners();
		this.#registerCampingListeners();
		this.#registerHeroCreationListener();
	}

	static #registerRollUpdateListener() {
		Sockets.on("updateRollDialog", (event) => {
			const { data } = event;
			const actor = game.actors.get(data.actorId);
			if (!actor) return warn(`Actor ${data.actorId} not found`);
			actor.sheet?.updateRollDialog(data);
		});

		Sockets.on("requestRollDialogSync", ({ data: { actorId } }) => {
			const actor = game.actors.get(actorId);
			if (!actor?.sheet?.hasRollDialog) return;
			const dialog = actor.sheet.rollDialogInstance;
			if (dialog.isOwner) dialog.dispatchSync();
		});
	}

	static #registerRollModerationListeners() {
		Sockets.on("rollDice", ({ data: { userId, data } }) => {
			if (userId !== game.userId) return;
			LitmRollDialog.roll(data);
		});

		Sockets.on("rejectRoll", ({ data: { actorId, name } }) => {
			ui.notifications.warn(
				game.i18n.format("LITM.Ui.roll_rejected", { name }),
			);
			const actor = game.actors.get(actorId);
			if (!actor?.sheet?.hasRollDialog) return;
			actor.sheet.renderRollDialog();
		});

		Sockets.on("resetRollDialog", ({ data: { actorId } }) => {
			const actor = game.actors.get(actorId);
			if (!actor?.sheet?.hasRollDialog) return;
			actor.sheet.resetRollDialog();
		});

		Sockets.on("closeRollDialog", ({ data: { actorId } }) => {
			const actor = game.actors.get(actorId);
			if (!actor?.sheet?.hasRollDialog) return;
			const dialog = actor.sheet.rollDialogInstance;
			if (dialog?.rendered) dialog.close();
		});

		// Post-roll bookkeeping for ally tags: the rolling client can't
		// update an effect on an actor it doesn't own, so it asks the
		// active GM to apply the scratch (burn / single-use consumption).
		Sockets.on("scratchEffect", async ({ data: { uuid } }) => {
			if (game.user !== game.users.activeGM) return;
			const effect = await foundry.utils.fromUuid(uuid);
			if (!effect || effect.system?.isScratched) return;
			const targetActor =
				effect.parent?.documentName === "Item"
					? effect.parent.parent
					: effect.parent;
			await scratchTag(targetActor, effect);
		});
	}

	static #registerStoryTagsListeners() {
		Sockets.on("storyTagsUpdate", async ({ data: { operation, data } }) => {
			// Exactly one GM applies the world-pack write — the active GM —
			// regardless of whether the Tags sidebar is open on any client.
			// (`doUpdate` self-guards GM and writes through ContentSources; the
			// sidebar never needed to be rendered.) Mirrors the scratchEffect
			// handler above. The previous `sidebar?.rendered` gate silently
			// dropped player edits when the GM's sidebar was closed and
			// double-applied when multiple GMs had it open.
			if (game.user !== game.users.activeGM) return;
			await getStoryTagSidebar()?.doUpdate(operation, data);
		});

		Sockets.on("storyTagsRender", () => {
			const sidebar = getStoryTagSidebar();
			if (sidebar?.rendered) {
				sidebar.invalidateCache();
				sidebar.render();
				sidebar.refreshRollDialogs();
			} else {
				game.actors.forEach((actor) => {
					if (!actor.sheet?.hasRollDialog) return;
					const dialog = actor.sheet.rollDialogInstance;
					if (dialog?.rendered) dialog.render();
				});
			}
		});
	}

	// Players without the core ACTOR_CREATE permission can't run Actor.create
	// themselves. When a GM is online, the hero-creation wizard dispatches the
	// assembled actor data here and the active GM creates it on their behalf,
	// granting the requesting player ownership. Mirrors the scratchEffect /
	// storyTagsUpdate GM-proxy pattern. The player learns of success via the
	// createActor hook (the actor carries a correlation flag), not a return
	// channel — the socket layer is fire-and-forget.
	static #registerHeroCreationListener() {
		Sockets.on(
			"createHeroAsGM",
			async ({ data: { actorData, userId, assignToUser } }) => {
				if (game.user !== game.users.activeGM) return;
				const data = foundry.utils.deepClone(actorData);
				foundry.utils.setProperty(
					data,
					`ownership.${userId}`,
					foundry.CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER,
				);
				const actor = await foundry.documents.Actor.create(data, {
					renderSheet: false,
					fromSidebar: false,
					litm: { skipHeroWizard: true, skipAutoSetup: true },
				});
				if (!actor) return;
				const user = game.users.get(assignToUser || userId);
				if (user && !user.character) await user.update({ character: actor.id });
			},
		);
	}

	static #registerCampingListeners() {
		Sockets.on("campingOpen", () => {
			Hooks.callAll("litm.camping.open");
		});
		Sockets.on("campingSaveOp", ({ data: { key, payload } }) => {
			Hooks.callAll("litm.camping.saveOp", { key, payload });
		});
		Sockets.on("campingEnd", () => {
			Hooks.callAll("litm.camping.end");
		});
	}
}
