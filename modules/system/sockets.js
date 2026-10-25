import { scratchOnce } from "../active-effects/scratchable-mixin.js";
import { gainImprovement } from "../actor/hero/hero-data.js";
import { resolveApprovedRoll } from "../apps/roll/moderation.js";
import { LitmRollDialog } from "../apps/roll/roll-dialog.js";
import {
	applySharedRoll,
	shouldJoinSharedRoll,
} from "../apps/roll/roll-request.js";
import {
	handleApplyStatusAsGM,
	handleApplySuccessAsGM,
} from "../apps/spend-power-service.js";
import { StoryTagsStore } from "../apps/story-tags/story-tags-store.js";
import { error, warn } from "../logger.js";
import { getStoryTagSidebar } from "../utils.js";
import { ContentSources } from "./content-sources.js";
import {
	checkImprove,
	checkScratch,
	relayReceipts,
	resolveRelayCard,
	sanitizeHeroRequest,
	sanitizeStoryOp,
} from "./relay-guards.js";

export class Sockets {
	static dispatch(event, data) {
		if (!game.ready) {
			return error(
				`Tried to dispatch ${event} socket event before the game was ready.`,
			);
		}

		const id = foundry.utils.randomID();
		game.socket.emit("system.litmv2", { id, data, event });
	}

	static #bound = false;

	static on(event, cb) {
		Hooks.on(`litm.socket.${event}`, cb);
		if (this.#bound) return;
		this.#bound = true;
		// The server appends the real sending user's id as the second argument
		// and drops any extra arguments a client emits; that, not anything in
		// the payload, is who sent the packet.
		game.socket.on("system.litmv2", (data, senderId) => {
			if (!game.users.get(senderId))
				return warn("Dropped a system socket packet with no attested sender");
			if (senderId === game.userId) return;
			const { event: e, senderId: _claimed, ...d } = data ?? {};
			Hooks.callAll(`litm.socket.${e}`, { ...d, senderId });
		});
	}

	static registerListeners() {
		this.#registerRollUpdateListener();
		this.#registerRollModerationListeners();
		this.#registerSharedRollListener();
		this.#registerStoryTagsListeners();
		this.#registerCampingListeners();
		this.#registerHeroCreationListener();
		this.#registerSuccessRelayListener();
	}

	static #registerRollUpdateListener() {
		Sockets.on("updateRollDialog", (event) => {
			const { data } = event;
			const actor = game.actors.get(data.actorId);
			if (!actor) return warn(`Actor ${data.actorId} not found`);
			actor.sheet?.updateRollDialog({ ...data, senderId: event.senderId });
		});

		Sockets.on("requestRollDialogSync", ({ data: { actorId, reseat } }) => {
			const actor = game.actors.get(actorId);
			if (!actor?.sheet?.hasRollDialog) return;
			const dialog = actor.sheet.rollDialogInstance;
			if (dialog.isOwner) dialog.dispatchSync();
			else if (reseat) dialog.dispatchReseat();
		});
	}

	// The Narrator's Call: the GM opened a shared roll and named who finishes
	// it. Everyone in the roll — the owner, plus any player who owns a
	// participating Hero in an Acting Together roll — opens the same dialog;
	// the rest of the table sees it on the roll-dialog HUD strip and joins if
	// they want to. There is no chat card: the roll posts its own.
	static #registerSharedRollListener() {
		Sockets.on("openRollDialog", ({ data }) => {
			if (!shouldJoinSharedRoll(data)) return;
			applySharedRoll(data);
		});
	}

	static #registerRollModerationListeners() {
		// Two GMs approving the same card each send this; roll it once.
		const approvedRolls = new Set();
		Sockets.on("rollDice", ({ senderId, data: { userId, messageId } }) => {
			if (approvedRolls.has(messageId)) return;
			const data = resolveApprovedRoll({ senderId, userId, messageId });
			if (data) approvedRolls.add(messageId);
			if (!data) return;
			LitmRollDialog.roll(data)?.catch(console.error);
		});

		Sockets.on("rejectRoll", ({ data: { actorId, name, userId } }) => {
			if (userId && userId !== game.userId) return;
			ui.notifications.warn(
				game.i18n.format("LITM.Ui.roll_rejected", { name }),
			);
			const actor = game.actors.get(actorId);
			if (!actor?.sheet?.hasRollDialog) return;
			actor.sheet.renderRollDialog();
		});

		Sockets.on("resetRollDialog", ({ data: { actorId, syncSession } }) => {
			const actor = game.actors.get(actorId);
			if (!actor?.sheet?.hasRollDialog) return;
			if (!actor.sheet.rollDialogInstance.matchesSyncSession(syncSession))
				return;
			actor.sheet.resetRollDialog();
		});

		Sockets.on(
			"closeRollDialog",
			({ data: { actorId, syncSession, preserveAuthority = false } }) => {
				const actor = game.actors.get(actorId);
				if (!actor?.sheet?.hasRollDialog) return;
				const dialog = actor.sheet.rollDialogInstance;
				if (!dialog.matchesSyncSession(syncSession)) return;
				dialog.endSharedRoll({ preserveAuthority });
				if (dialog?.rendered) dialog.close();
			},
		);

		// Post-roll bookkeeping for ally tags, and Spend Power's scratch: the
		// sender can't update an effect on an actor it doesn't own, so it asks
		// the active GM, citing the roll card that earned the scratch.
		// Hooks.callAll drops a relay's promise, so each relay logs its own
		// failure rather than leave an unhandled rejection on the GM client.
		Sockets.on(
			"scratchEffect",
			async ({ senderId, data: { uuid, messageId, via } }) => {
				if (game.user !== game.users.activeGM) return;
				try {
					const effect = await foundry.utils.fromUuid(uuid);
					if (!effect) return;
					const sender = game.users.get(senderId);
					const { card, ownsRollActor } = resolveRelayCard(sender, messageId);
					const verdict = checkScratch({
						sender,
						card,
						ownsRollActor,
						via,
						effect: {
							uuid: effect.uuid,
							type: effect.type,
							isSingleUse: !!effect.system?.isSingleUse,
							isHidden: !!effect.system?.isHidden,
						},
						receipts: relayReceipts,
					});
					if (!verdict.ok)
						return warn(
							`scratchEffect rejected: ${verdict.reason} (senderId ${senderId}, uuid ${uuid}, messageId ${messageId})`,
						);
					if (card) relayReceipts.add(card.id, `scratch:${effect.uuid}`);
					await scratchOnce(effect);
				} catch (err) {
					error("scratchEffect relay failed", err);
				}
			},
		);

		// Same relay for Improve: a contributed weakness marks the theme of a
		// Hero the roller doesn't own.
		// Marks are applied one at a time: two weaknesses on the same theme
		// arrive as two packets, and concurrent handlers would both read the
		// same Improve value and write the same +1.
		let improveQueue = Promise.resolve();
		Sockets.on(
			"gainImprovement",
			({ senderId, data: { actorId, tag, messageId } }) => {
				if (game.user !== game.users.activeGM) return;
				improveQueue = improveQueue.then(async () => {
					try {
						// The live effect decides what is marked; the payload's type
						// is ignored.
						const effect = tag?.uuid
							? await foundry.utils.fromUuid(tag.uuid)
							: null;
						if (!effect) return;
						const sender = game.users.get(senderId);
						const { card, ownsRollActor } = resolveRelayCard(sender, messageId);
						const verdict = checkImprove({
							sender,
							card,
							ownsRollActor,
							actorId,
							effect: { uuid: effect.uuid, type: effect.type },
							receipts: relayReceipts,
						});
						if (!verdict.ok)
							return warn(
								`gainImprovement rejected: ${verdict.reason} (senderId ${senderId}, uuid ${tag.uuid}, messageId ${messageId})`,
							);
						if (card) relayReceipts.add(card.id, `improve:${effect.uuid}`);
						const actor = game.actors.get(actorId);
						if (actor)
							await gainImprovement(actor, {
								type: effect.type,
								uuid: effect.uuid,
							});
					} catch (err) {
						error("gainImprovement relay failed", err);
					}
				});
			},
		);
	}

	static #registerStoryTagsListeners() {
		Sockets.on(
			"storyTagsUpdate",
			async ({ senderId, data: { operation, data, messageId } }) => {
				// Exactly one GM applies the world-pack write — the active GM —
				// regardless of whether the Tags sidebar is open on any client.
				// (`doUpdate` self-guards GM and writes through ContentSources; the
				// sidebar never needed to be rendered.) Mirrors the scratchEffect
				// handler above. The previous `sidebar?.rendered` gate silently
				// dropped player edits when the GM's sidebar was closed and
				// double-applied when multiple GMs had it open.
				if (game.user !== game.users.activeGM) return;
				try {
					// The sidebar's player-side checks are UI; re-apply them here.
					const sender = game.users.get(senderId);
					const tags = await ContentSources.getStoryTags();
					const verdict = sanitizeStoryOp(operation, data, {
						sender,
						tags: new Map(
							tags.map((e) => [
								e.id,
								{ uuid: e.uuid, isHidden: !!e.system?.isHidden },
							]),
						),
						limitIds: new Set(StoryTagsStore.storyLimits.map((l) => l.id)),
						...resolveRelayCard(sender, messageId),
					});
					if (!verdict.ok)
						return warn(
							`storyTagsUpdate rejected: ${verdict.reason} (senderId ${senderId}, operation ${operation})`,
						);
					await getStoryTagSidebar()?.doUpdate(operation, verdict.data);
				} catch (err) {
					error("storyTagsUpdate relay failed", err);
				}
			},
		);

		// The sender fires `litm.sceneTagsChanged` locally; this is the same
		// signal for everyone else. Its listeners re-render roll dialogs and
		// token labels, so third-party listeners see remote changes too.
		Sockets.on("storyTagsRender", () => {
			const sidebar = getStoryTagSidebar();
			if (sidebar?.rendered) {
				sidebar.invalidateCache();
				sidebar.render();
			}
			Hooks.callAll("litm.sceneTagsChanged");
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
		// One creation in flight per player, so a flood can't fill the world.
		const inFlight = new Set();
		Sockets.on("createHeroAsGM", async ({ senderId, data }) => {
			if (game.user !== game.users.activeGM) return;
			const sender = game.users.get(senderId);
			// Rebuilt from what the wizard sends: no ownership, folder or flags
			// from the payload, and only the sender can own or be assigned it.
			const verdict = sanitizeHeroRequest({
				sender,
				payload: data,
				levels: foundry.CONST.DOCUMENT_OWNERSHIP_LEVELS,
			});
			if (!verdict.ok)
				return warn(
					`createHeroAsGM rejected: ${verdict.reason} (senderId ${senderId})`,
				);
			if (inFlight.has(senderId))
				return warn(
					`createHeroAsGM rejected: a creation is in flight (senderId ${senderId})`,
				);
			inFlight.add(senderId);
			try {
				const actor = await foundry.documents.Actor.create(verdict.actorData, {
					renderSheet: false,
					fromSidebar: false,
					litm: { skipHeroWizard: true, skipAutoSetup: true },
				});
				if (actor && !sender.character)
					await sender.update({ character: actor.id });
			} catch (err) {
				error("createHeroAsGM relay failed", err);
			} finally {
				inFlight.delete(senderId);
			}
		});
	}

	// Players can't mutate actors they don't own; when a Spend Power action
	// success targets a GM-owned actor (or limit), the player's client relays
	// the fully-resolved apply here and the active GM executes it — flags,
	// chat card and all. Mirrors the scratchEffect / storyTagsUpdate GM-proxy
	// pattern; the handlers check the card and its Power budget.
	static #registerSuccessRelayListener() {
		Sockets.on("applySuccessAsGM", async ({ senderId, data }) => {
			if (game.user !== game.users.activeGM) return;
			await handleApplySuccessAsGM({ ...data, senderId });
		});

		// Same trust model for the generic Spend Power options: Inflict's
		// status add and Reduce's tier drop on actors the player doesn't own.
		Sockets.on("applyStatusAsGM", async ({ senderId, data }) => {
			if (game.user !== game.users.activeGM) return;
			await handleApplyStatusAsGM({ ...data, senderId });
		});
	}

	static #registerCampingListeners() {
		// Both carry the scene the camp's session lives on: it need not be the
		// scene a given client is looking at.
		Sockets.on("campingOpen", ({ data }) => {
			Hooks.callAll("litm.camping.open", { sceneId: data?.sceneId });
		});
		Sockets.on("campingSaveOp", ({ data: { key, payload, sceneId } }) => {
			Hooks.callAll("litm.camping.saveOp", { key, payload, sceneId });
		});
		// A second GM's Begin Camp / Pack Up / Cancel, run by the active GM.
		Sockets.on("campingLifecycle", ({ data }) => {
			Hooks.callAll("litm.camping.lifecycle", {
				action: data?.action,
				sceneId: data?.sceneId,
			});
		});
		Sockets.on("campingEnd", () => {
			Hooks.callAll("litm.camping.end");
		});
	}
}
