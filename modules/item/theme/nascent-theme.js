import { completeTrackUpdate } from "../../system/chat.js";

/**
 * Mark Improve on a theme — the one write for an Improve mark, from a roll's
 * invoked weakness or a click on the track. A nascent theme (Core Book p.192)
 * takes a new power tag instead: the mark is owed as a power tag and the
 * usual "Choose Improvement" card opens the advancement window, locked to
 * adding one.
 * @param {Item} theme
 * @param {Actor} owner          The actor owning the theme
 * @param {Actor} [notifyActor]  Who the card speaks for; defaults to owner
 * @returns {Promise<object|null>} The trackInfo fired, or null
 */
export async function markImprove(theme, owner, notifyActor) {
	if (theme.system?.nascentTagsToOwe > 0) {
		await theme.update({
			"system.nascentPending": theme.system.nascentPending + 1,
		});
		const trackInfo = {
			text: game.i18n.format("LITM.Ui.nascent_power_tag_due", {
				actor: owner.name,
				theme: theme.name,
			}),
			type: "improve",
			actorId: theme.parent?.id ?? owner.id,
			themeId: theme.id,
		};
		Hooks.callAll("litm.trackCompleted", {
			actor: notifyActor ?? owner,
			trackInfo,
		});
		return trackInfo;
	}
	return completeTrackUpdate(
		theme,
		"system.improve.value",
		(theme.system?.improve?.value ?? 0) + 1,
		owner,
		notifyActor,
	);
}
