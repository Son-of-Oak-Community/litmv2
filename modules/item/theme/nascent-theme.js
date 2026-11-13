import { completeTrackUpdate } from "../../system/chat.js";
import { NASCENT_POWER_TAGS } from "./theme-data.js";

/**
 * Mark Improve on a theme — the one write for an Improve mark, from a roll's
 * invoked weakness, a click on the track or camp. A nascent theme (Core Book
 * p.192) takes a new power tag instead: each mark is owed as a power tag
 * until every missing tag is owed, the usual "Choose Improvement" card opens
 * the advancement window locked to adding one, and any marks left over go on
 * the Improve track as usual.
 * @param {Item} theme
 * @param {Actor} owner          The actor owning the theme
 * @param {Actor} [notifyActor]  Who the card speaks for; defaults to owner
 * @param {object} [options]
 * @param {number} [options.marks=1]  How many Improve marks to make
 * @returns {Promise<object|null>} The trackInfo fired, or null
 */
export async function markImprove(theme, owner, notifyActor, { marks = 1 } = {}) {
	const owed = Math.min(marks, theme.system?.nascentTagsToOwe ?? 0);
	if (owed > 0) {
		await theme.update({
			"system.nascentPending": theme.system.nascentPending + owed,
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
		if (marks === owed) return trackInfo;
	}
	return completeTrackUpdate(
		theme,
		"system.improve.value",
		Math.min(
			CONFIG.litmv2.improveThreshold,
			(theme.system?.improve?.value ?? 0) + marks - owed,
		),
		owner,
		notifyActor,
	);
}

/**
 * End a theme's nascent stage once it has three power tags, however they
 * came: the advancement window, the sheet's edit mode, a drop. Without this
 * a theme that later lost a tag would turn nascent again.
 * @param {Item} theme
 */
export async function settleNascent(theme) {
	if (theme?.type !== "theme") return;
	const system = theme.system;
	if (!system?.nascentImprovements) return;
	if (system.powerTagCount < NASCENT_POWER_TAGS) return;
	await theme.update({
		"system.nascentImprovements": 0,
		"system.nascentPending": 0,
	});
}
