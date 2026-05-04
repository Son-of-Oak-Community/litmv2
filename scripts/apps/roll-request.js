import { localize as t } from "../utils.js";

const { DialogV2 } = foundry.applications.api;

/**
 * Compose and post a roll-request chat message asking a player to roll the
 * given action on a target hero. Whispers the message to all owners of the
 * target actor (so unrelated players don't see the prompt).
 *
 * GM-only: the dialog and posting flow assume the caller is a Narrator.
 *
 * @param {object} args
 * @param {Item} args.action  The action item being requested.
 * @returns {Promise<ChatMessage|null>}
 */
export async function sendRollRequest({ action }) {
	if (!game.user.isGM) {
		ui.notifications.warn(t("LITM.Actions.gm_only"));
		return null;
	}
	if (!action || action.type !== "action") return null;

	const heroes = game.actors.contents.filter((a) => a.type === "hero");
	if (!heroes.length) {
		ui.notifications.warn(t("LITM.Actions.request_no_heroes"));
		return null;
	}

	const formHtml = await foundry.applications.handlebars.renderTemplate(
		"systems/litmv2/templates/apps/roll-request-form.html",
		{ heroes: heroes.map((a) => ({ id: a.id, name: a.name })) },
	);

	let payload;
	try {
		payload = await DialogV2.prompt({
			window: { title: t("LITM.Actions.request_dialog_title") },
			content: formHtml,
			ok: {
				label: t("LITM.Actions.request_send"),
				callback: (_event, button) => {
					const form = button.form;
					return {
						actorId: form.querySelector("[name='actorId']").value,
						note: (form.querySelector("[name='note']").value ?? "").trim(),
					};
				},
			},
			rejectClose: false,
		});
	} catch {
		return null;
	}
	if (!payload?.actorId) return null;

	const requestedActor = game.actors.get(payload.actorId);
	if (!requestedActor) return null;

	const recipients = [
		...game.users.filter((u) => requestedActor.testUserPermission(u, "OWNER")).map((u) => u.id),
	];
	// Always include sender so the GM also sees it.
	if (!recipients.includes(game.user.id)) recipients.push(game.user.id);

	const content = await foundry.applications.handlebars.renderTemplate(
		"systems/litmv2/templates/chat/roll-request.html",
		{
			actionName: action.name,
			practitioners: action.system.practitioners,
			requestedActorName: requestedActor.name,
			note: payload.note,
		},
	);

	return foundry.documents.ChatMessage.create({
		content,
		whisper: recipients,
		flags: {
			litmv2: {
				rollRequest: {
					actionUuid: action.uuid,
					requestedActorId: requestedActor.id,
					fromUserId: game.user.id,
					note: payload.note,
				},
			},
		},
	});
}
