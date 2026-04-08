import { error, warn } from "../logger.js";

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

	static #handlers = new Map();
	static #bound = false;

	static on(event, cb) {
		if (this.#handlers.has(event)) {
			warn(`Sockets.on: handler for "${event}" is being overwritten.`);
		}
		this.#handlers.set(event, cb);
		if (this.#bound) return;
		this.#bound = true;
		game.socket.on("system.litmv2", (data) => {
			const { event: e, senderId, ...d } = data;
			if (senderId === game.userId) return;
			this.#handlers.get(e)?.(d);
		});
	}

	static registerListeners() {
		this.#registerRollUpdateListener();
		this.#registerRollModerationListeners();
		this.#registerStoryTagsListeners();
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
			game.litmv2.LitmRollDialog.roll(data);
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
	}

	static #registerStoryTagsListeners() {
		Sockets.on("storyTagsUpdate", ({ data: { component, data } }) => {
			const sidebar = game.litmv2.storyTags;
			if (sidebar?.rendered) sidebar.doUpdate(component, data);
		});

		Sockets.on("storyTagsRender", () => {
			const sidebar = game.litmv2.storyTags;
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
}
