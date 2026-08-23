import { warn } from "../../logger.js";
import { tagChipHtml } from "../../system/renderers/renderer-utils.js";
import { Sockets } from "../../system/sockets.js";
import { localize as t } from "../../utils.js";
import {
	buildNarratorSelections,
	normalizeCallType,
	resolveCallDelivery,
	summarizeNarratorTags,
} from "./narrator-call-rules.js";

/**
 * Delivery for the Narrator's Call: turning the Narrator's half of a roll
 * into something a player can pick up.
 *
 * Two channels, deliberately. The **chat card** is the durable artefact — it
 * is whispered to every owner of the Hero, so a player who was disconnected
 * finds the call waiting at login, and the Narrator keeps a record of what
 * they asked for. The **socket** is only the nudge that opens the dialog on
 * an already-connected player's screen. Neither is load-bearing alone.
 */

/**
 * Render the Narrator's invocations as tag chips, through the system's one
 * sanctioned chip builder so the card matches every other tag surface.
 * @param {{name: string, type: string, value?: number}[]} tags
 * @returns {string} HTML
 */
export function narratorTagChips(tags = []) {
	return tags
		.map((tag) => {
			if (tag.type === "status_tag")
				return tagChipHtml({ kind: "status", name: tag.name, tier: tag.value });
			if (tag.type === "weakness_tag")
				return tagChipHtml({ kind: "weakness", name: tag.name });
			return tagChipHtml({ kind: "tag", name: tag.name });
		})
		.join(" ");
}

/**
 * Hand a configured roll to the table.
 *
 * @param {object} call
 * @param {string} call.actorId       The Hero being called on.
 * @param {string} call.type          quick | tracked | mitigate
 * @param {string} [call.title]       What the roll is for.
 * @param {string} [call.note]        Free prose from the Narrator.
 * @param {number} [call.might]       Might difference the Narrator judged.
 * @param {string|null} [call.actionUuid]
 * @param {Map<string, object>|[string, object][]} [call.selections]
 *   The Narrator's tag invocations, straight off the call app.
 * @returns {Promise<ChatMessage|null>}
 */
export async function sendNarratorCall({
	actorId,
	type,
	title = "",
	note = "",
	might = 0,
	actionUuid = null,
	selections = [],
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

	const narratorUserId = game.user.id;
	const payload = {
		call: true,
		actorId,
		requestedActorId: actorId,
		type: normalizeCallType(type),
		title,
		note,
		might: Number(might) || 0,
		actionUuid,
		selections: buildNarratorSelections(selections, narratorUserId),
		narratorUserId,
		narratorName: game.user.name,
		fromUserId: narratorUserId,
	};

	// Cancellable: a module may veto or rewrite a call before it goes out.
	if (Hooks.call("litm.narratorCall", payload, actor) === false) return null;

	const owners = game.users
		.filter((u) => actor.testUserPermission(u, "OWNER"))
		.map((u) => ({ id: u.id, active: u.active, isGM: u.isGM }));
	const { mode, rollerIds, whisper } = resolveCallDelivery({
		owners,
		narratorUserId,
	});

	const message = await _postCallCard({ actor, payload, mode, whisper });

	if (mode === "player") {
		Sockets.dispatch("narratorCall", { ...payload, rollerIds });
	} else {
		// Nobody is connected to play this Hero. Rather than dropping the call
		// or parking it in a queue, the Narrator finishes it themselves in the
		// same dialog — post-roll writes to the unowned Hero are already the
		// GM's to make, so no extra authorization path is needed.
		ui.notifications.info(
			game.i18n.format("LITM.Ui.narrator_call_rolling_yourself", {
				name: actor.name,
			}),
		);
		applyNarratorCall(payload);
	}

	return message;
}

async function _postCallCard({ actor, payload, mode, whisper }) {
	const tags = [];
	for (const [uuid, sel] of payload.selections) {
		const effect = foundry.utils.fromUuidSync(uuid);
		if (!effect) continue;
		tags.push({
			name: effect.name,
			type: effect.type,
			value: effect.system?.currentTier ?? 0,
			state: sel.state,
		});
	}
	const { helpful, hindering } = summarizeNarratorTags(tags);
	const action = payload.actionUuid
		? await foundry.utils.fromUuid(payload.actionUuid)
		: null;

	const content = await foundry.applications.handlebars.renderTemplate(
		"systems/litmv2/templates/chat/roll-request.html",
		{
			narratorName: payload.narratorName,
			typeLabel: t(`LITM.Ui.roll_${payload.type}`),
			requestedActorName: actor.name,
			requestedActorImg: actor.prototypeToken?.texture?.src || actor.img,
			rollTitle: payload.title,
			actionName: action?.name ?? "",
			practitioners: action?.system?.practitioners ?? "",
			note: payload.note,
			might: payload.might,
			helpfulChips: helpful.length ? narratorTagChips(helpful) : "",
			hinderingChips: hindering.length ? narratorTagChips(hindering) : "",
			// When the call already landed on the Narrator's own screen there is
			// nothing left to take — the card is just the record of it.
			showTake: mode === "player",
		},
	);

	return foundry.documents.ChatMessage.create({
		content,
		whisper,
		flags: { litmv2: { rollRequest: payload } },
	});
}

/**
 * Adopt a Narrator's Call on this client: seed the Hero's roll dialog with
 * the Narrator's move, invocations and Might, then open it. Shared by the
 * socket handler, the chat card's Take button, and the Narrator's own
 * offline fallback — one apply path, so the dialog can only be seeded one
 * way.
 *
 * @param {object} call
 */
export function applyNarratorCall(call) {
	const actor = game.actors.get(call.actorId ?? call.requestedActorId);
	if (!actor) return warn("Narrator's Call: target actor not found", call);
	const sheet = actor.sheet;
	const dialog = sheet?.rollDialogInstance;
	if (!dialog) return warn("Narrator's Call: hero has no roll dialog", call);

	dialog.applyNarratorCall(call);
	if (typeof sheet.renderRollDialog === "function") sheet.renderRollDialog();
	else if (!dialog.rendered) dialog.render(true);
}

/**
 * Ask for a roll of a specific Action item. Kept as the entry point the
 * action sheet, the actions browser and the `@action` enricher already call;
 * it now opens the Narrator's Call pre-linked to the action rather than its
 * own one-off prompt, so there is a single "GM asks for a roll" surface.
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
	if (!game.actors.some((a) => a.type === "hero")) {
		ui.notifications.warn(t("LITM.Actions.request_no_heroes"));
		return null;
	}
	const { NarratorCallApp } = await import("./narrator-call.js");
	return NarratorCallApp.open({
		actionUuid: action.uuid,
		title: action.name,
	});
}
