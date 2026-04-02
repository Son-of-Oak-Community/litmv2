export const TRACK_ICONS = {
	promise: "fa-sun",
	improve: "fa-arrow-trend-up",
	milestone: "fa-mountain-sun",
	abandon: "fa-wind",
	limit: "fa-shield",
};

export const TRACK_LABEL_KEYS = {
	promise: "LITM.Ui.track_complete_promise",
	improve: "LITM.Ui.track_complete_improve",
	milestone: "LITM.Ui.track_complete_milestone",
	abandon: "LITM.Ui.track_complete_abandon",
	limit: "LITM.Ui.track_complete_limit",
};

/**
 * Detect whether a track update is a completion event.
 * @param {string} attrib   The attribute path being updated
 * @param {number} newValue The new value
 * @param {Document} doc    The document being updated (actor or item)
 * @param {Actor} actor     The owning actor
 * @returns {object|null}   Track info object, or null if not a completion
 */
export function detectTrackCompletion(attrib, newValue, doc, actor) {
	const isTheme = doc !== actor;
	const isFellowship = isTheme && (doc.system?.isFellowship ?? false);

	// Promise track (on the actor, max 5)
	if (attrib === "system.promise" && newValue === 5) {
		return {
			text: game.i18n.format("LITM.Ui.promise_complete", {
				actor: actor.name,
			}),
			type: "promise",
		};
	}

	if (!isTheme) return null;

	const themeLabel = isFellowship
		? game.i18n.format("LITM.Ui.fellowship_theme_label", { theme: doc.name })
		: doc.name;

	// Improve (max 3)
	if (attrib === "system.improve.value" && newValue === 3) {
		return {
			text: game.i18n.format("LITM.Ui.improve_complete", {
				actor: actor.name,
				theme: themeLabel,
			}),
			type: "improve",
			actorId: doc.parent?.id ?? actor.id,
			themeId: doc.id,
		};
	}

	// Milestone / Abandon (max 3)
	if (newValue === 3) {
		const isMilestone = attrib.includes("milestone");
		const isAbandon = attrib.includes("abandon");
		if (isMilestone || isAbandon) {
			const trackKey = isMilestone
				? "LITM.Themes.milestone"
				: "LITM.Themes.abandon";
			return {
				text: game.i18n.format("LITM.Ui.theme_track_complete", {
					actor: actor.name,
					theme: themeLabel,
					track: game.i18n.localize(trackKey),
				}),
				type: isMilestone ? "milestone" : "abandon",
			};
		}
	}

	return null;
}

export function buildTrackCompleteContent({ text, type, actorId, themeId }) {
	const esc = foundry.utils.escapeHTML;
	const icon = TRACK_ICONS[type];
	const label = game.i18n.localize(TRACK_LABEL_KEYS[type]);
	const footer =
		type === "improve" && actorId && themeId
			? `<footer class="litm-track-complete__footer">
				<button type="button" data-click="open-theme-advancement"
				        data-actor-id="${esc(actorId)}" data-theme-id="${esc(themeId)}">
					<i class="fas fa-wand-magic-sparkles"></i> ${game.i18n.localize("LITM.Ui.choose_improvement")}
				</button>
			</footer>`
			: "";
	return `<div class="litmv2 litm-track-complete litm-track-complete--${esc(type)}">
		<header class="litm-track-complete__header">
			<i class="fas ${icon}"></i>
			<span>${label}</span>
		</header>
		<p class="litm-track-complete__body"><strong>${esc(text)}</strong></p>
		${footer}
	</div>`;
}
