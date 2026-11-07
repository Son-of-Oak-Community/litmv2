import { warn } from "../../logger.js";
import { FLAGS } from "../../system/config.js";
import { Sockets } from "../../system/sockets.js";
import { localize as t } from "../../utils.js";
import { resolveSharedRollOwner } from "./roll-authority.js";

/**
 * The Narrator's Call, as a shared table rather than a handoff.
 *
 * Core Book p.269 puts the choice of outcome method in the Narrator's hands,
 * and p.272 has them invoke the tags of "the target of the action, the
 * opposition, or the environment" before the dice come out. The old shape of
 * this module shipped that whole judgement to the player in a whispered card;
 * the shape here opens **one roll object** on both screens instead. The
 * Narrator picks who is rolling and nothing else — everything after that
 * happens inside `LitmRollDialog`, where the Narrator sets the move, the Might
 * and their invocations while the roller sets theirs.
 *
 * Pickup is the roll-dialog HUD strip in `#players`, driven by the same
 * `rollDialogOwner` flag every other open roll uses. There is no durable chat
 * record of a call: the roll produces its own card.
 */

/**
 * Open a shared roll on every screen that belongs in it.
 *
 * @param {object} call
 * @param {string} call.actorId            Hero, or the Fellowship for a group roll.
 * @param {string[]} [call.participantIds] Acting Together participants.
 * @param {string|null} [call.actionUuid]
 * @param {string} [call.title]
 * @param {string} [call.type]             quick | tracked | mitigate
 * @returns {Promise<object|null>} The dispatched payload, or null.
 */
export async function openSharedRoll({
	actorId,
	participantIds = [],
	actionUuid = null,
	title = "",
	type = "quick",
}) {
	if (!game.user.isGM) {
		ui.notifications.warn(t("LITM.Actions.gm_only"));
		return null;
	}
	const actor = game.actors.get(actorId);
	if (!actor) {
		ui.notifications.warn(t("LITM.Actions.apply_no_actor"));
		return null;
	}

	// A group roll rides the Fellowship, which the Narrator owns and rolls —
	// so it deliberately offers no player owners and falls through to the GM.
	const isGroupRoll = actor.id === game.litmv2?.fellowship?.id;
	const owners = isGroupRoll
		? []
		: game.users
				.filter((u) => actor.testUserPermission(u, "OWNER"))
				.map((u) => ({ id: u.id, active: u.active, isGM: u.isGM }));

	const payload = {
		actorId,
		ownerId: resolveSharedRollOwner({ owners, gmUserId: game.user.id }),
		participantIds: [...participantIds],
		actionUuid,
		title,
		type,
		narratorUserId: game.user.id,
		narratorName: game.user.name,
		syncSession: foundry.utils.randomID(),
	};

	// Cancellable: a module may veto or rewrite a call before it goes out.
	if (Hooks.call("litm.narratorCall", payload, actor) === false) return null;

	// Advertise the roll before opening it, so the HUD strip lights up for
	// everyone the call didn't reach directly. The GM writes this flag on the
	// roller's behalf — `updatePresence` would refuse, since the GM is not the
	// owner of a single-hero call.
	await actor.setFlag("litmv2", FLAGS.rollDialogOwner, {
		ownerId: payload.ownerId,
		openedAt: Date.now(),
		type: payload.type,
		syncSession: payload.syncSession,
		// Marks the seat as assigned rather than merely occupied.
		// `resolveRollDialogOwnership` lets a player take over a dialog a GM is
		// holding, which is right for an ordinary roll and wrong here: on a
		// group roll it would hand the Fellowship's dialog to whichever player
		// happens to own that actor.
		narrator: true,
		// What the call was, so an owner reopening it with nobody left to
		// answer the reseat rebuilds the call instead of a blank roll.
		call: {
			participantIds: payload.participantIds,
			actionUuid: payload.actionUuid,
			title: payload.title,
			narratorUserId: payload.narratorUserId,
			narratorName: payload.narratorName,
		},
	});

	Sockets.dispatch("openRollDialog", payload);
	applySharedRoll(payload);
	return payload;
}

/**
 * Whether this client is *in* the roll, as opposed to merely at the table.
 *
 * The roller is, and so is any player who owns a participating Hero in an
 * Acting Together roll — they have a tag to contribute. Everyone else learns
 * about it from the HUD strip and joins if they want to, which is what Filip
 * asked for: "players whose character was not selected get the notification".
 *
 * @param {{ownerId?: string, participantIds?: string[]}} call
 * @returns {boolean}
 */
export function shouldJoinSharedRoll({ ownerId, participantIds = [] } = {}) {
	if (ownerId === game.user.id) return true;
	return participantIds.some((id) => {
		const hero = game.actors.get(id);
		return !!hero?.testUserPermission(game.user, "OWNER");
	});
}

/**
 * Adopt a shared roll on this client: seed the actor's roll dialog with who
 * owns it, what it is about and the Narrator's stamp, then open it. Shared by
 * the socket handler and the Narrator's own client, so the dialog can only be
 * seeded one way.
 *
 * @param {object} call
 */
export function applySharedRoll(call) {
	const actor = game.actors.get(call.actorId);
	if (!actor) return warn("Shared roll: target actor not found", call);
	const sheet = actor.sheet;
	const dialog = sheet?.rollDialogInstance;
	if (!dialog) return warn("Shared roll: actor sheet has no roll dialog", call);

	dialog.configureSharedRoll(call);
	dialog.render(true);
	// The roller's client is the one that syncs the shared object outward, so
	// a peer opening later sees the same selections.
	if (dialog.isOwner) dialog.dispatchSync();
}

/**
 * What the "ask for a roll" button on an Action should say.
 *
 * An Action embedded on a Hero calls the roll for that Hero, so the button
 * has to read as calling on them by name rather than as sending a request
 * into the void. Anything else falls back to the generic label, because it
 * genuinely does open a picker.
 *
 * @param {Actor|null} [owner] The Actor the Action is embedded on, if any.
 * @returns {string}
 */
export function callForRollLabel(owner) {
	return owner?.type === "hero"
		? game.i18n.format("LITM.Actions.call_for_actor", { name: owner.name })
		: t("LITM.Actions.request_dialog_title");
}

/**
 * Ask for a roll of a specific Action item. The entry point the action sheet,
 * the actions browser and the `@action` enricher all call.
 *
 * **An Action embedded on a Hero already knows who is rolling it**, so it
 * calls the roll for that Hero instead of opening a picker with nobody
 * chosen. Both call sites had the actor in hand and threw it away; the Action
 * itself is the better discriminator, because it is right for the enricher
 * too, which has no surrounding actor to consult.
 *
 * A world or compendium Action, or one embedded on something that is not a
 * Hero, still opens the picker pre-linked — there is genuinely no answer to
 * "who" in that case.
 *
 * @param {object} args
 * @param {Item} args.action
 */
export async function sendRollRequest({ action }) {
	if (!game.user.isGM) {
		ui.notifications.warn(t("LITM.Actions.gm_only"));
		return null;
	}
	if (!action || action.type !== "action") return null;

	const owner = action.parent;
	if (owner?.type === "hero")
		return openSharedRoll({
			actorId: owner.id,
			actionUuid: action.uuid,
			title: action.name,
		});

	if (!game.actors.some((a) => a.type === "hero")) {
		ui.notifications.warn(t("LITM.Actions.request_no_heroes"));
		return null;
	}
	const { CallForRollApp } = await import("./call-for-roll.js");
	return CallForRollApp.open({
		actionUuid: action.uuid,
		title: action.name,
	});
}

/**
 * A player raising a hand: "I'd like to roll."
 *
 * The reverse of the Narrator's Call, and deliberately not its mirror image.
 * A call opens a whole roll object on both screens, so it needs no chat
 * record. A request opens nothing — the player cannot compose a roll when
 * `player_initiated_rolls` is off, so there is nothing to look at together and
 * the ask has to survive a Narrator who is mid-sentence. That makes a
 * whispered card the right shape: durable, and it carries the one button that
 * turns the ask into a call.
 *
 * The card's only client-authored datum is which Hero asked, and the Narrator
 * reads that name before clicking. Nothing executes on anyone else's client —
 * `openSharedRoll` is GM-gated and runs on the Narrator's own initiative — so
 * this needs none of `resolveApprovedRoll`'s hardening.
 *
 * @param {Actor} actor The Hero whose player is asking.
 * @returns {Promise<ChatMessage|LitmRollDialog|null>} The request card, or the joined dialog.
 */
export async function requestRollFromNarrator(actor) {
	if (!actor) return null;
	// A live roll for this Hero is already the thing they are asking for: join
	// it. The HUD strip hides from the seat's owner, so after a reload this is
	// their only way back in.
	if (actor.getFlag("litmv2", FLAGS.rollDialogOwner))
		return actor.sheet?.renderRollDialog() ?? null;
	const narrators = game.users.filter((u) => u.isGM && u.active);
	if (!narrators.length) {
		ui.notifications?.warn(t("LITM.Ui.roll_request_no_narrator"));
		return null;
	}
	const message = await foundry.documents.ChatMessage.create({
		whisper: narrators.map((u) => u.id),
		speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
		content: await foundry.applications.handlebars.renderTemplate(
			"systems/litmv2/templates/chat/roll-request.html",
			{ actorId: actor.id, name: actor.name },
		),
		flags: { litmv2: { rollRequestFrom: { actorId: actor.id } } },
	});
	ui.notifications?.info(t("LITM.Ui.roll_request_sent"));
	return message;
}

/**
 * Cards being answered right now. Claim-by-delete alone settles the race
 * correctly: the loser finds the card gone and stops. This is for the console.
 * A second click on the same client makes Foundry log its own "ChatMessage
 * does not exist" before the delete rejects, and two red errors for a
 * double-click is a bad look for a working outcome. Same guard, same reason,
 * as the moderation handlers.
 */
const requestsInFlight = new Set();

/**
 * The Narrator picking up a player's "I'd like to roll" (see
 * {@link requestRollFromNarrator}). Turning the ask into a call is the whole
 * action, so the card goes as soon as it is answered: the same claim-by-delete
 * the moderation cards use, which keeps a second Narrator from calling it
 * twice.
 *
 * Two things the card cannot know, because it is a durable record of a moment
 * that has passed:
 *
 * - A roll may be open for that Hero by now (called from the picker, a
 *   reaction, a Sacrifice). Calling again would re-stamp the presence flag and
 *   `configureSharedRoll` would wipe whatever the player has selected, so the
 *   card steps aside instead.
 * - The call may not open. A module vetoing `litm.narratorCall`, or a failed
 *   write, would otherwise lose the request along with the card, so the card
 *   goes back.
 *
 * @param {ChatMessage} message The roll-request card.
 */
export async function answerRollRequest(message) {
	if (!game.user.isGM) return;
	if (requestsInFlight.has(message.id)) return;
	requestsInFlight.add(message.id);
	try {
		const actorId = message.getFlag("litmv2", "rollRequestFrom")?.actorId;
		const actor = actorId ? game.actors.get(actorId) : null;
		if (!actor) {
			ui.notifications.warn(t("LITM.Actions.apply_no_actor"));
			return;
		}
		// The same truthy check `requestRollFromNarrator` makes when the card is
		// sent, made again because the roll may have opened since.
		if (actor.getFlag("litmv2", FLAGS.rollDialogOwner)) {
			await message.delete().catch(() => null);
			ui.notifications.info(
				game.i18n.format("LITM.Ui.roll_request_superseded", {
					name: actor.name,
				}),
			);
			return;
		}
		const claimed = await message.delete().catch(() => null);
		if (!claimed) {
			warn(`Roll request ${message.id} was already answered elsewhere.`);
			return;
		}
		let opened = null;
		try {
			opened = await openSharedRoll({ actorId: actor.id });
		} catch (err) {
			console.error(err);
		}
		if (!opened) await restoreRollRequest(message);
	} finally {
		requestsInFlight.delete(message.id);
	}
}

/**
 * Post a claimed card again as a new document: the old id is already being
 * deleted on every client.
 * @param {ChatMessage} message
 */
async function restoreRollRequest(message) {
	const { whisper, speaker, content, flags } = message.toObject();
	await foundry.documents.ChatMessage.create({
		whisper,
		speaker,
		content,
		flags,
	}).catch(console.error);
}
