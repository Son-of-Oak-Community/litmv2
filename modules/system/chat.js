const TRACK_ICONS = {
	promise: "fa-sun",
	improve: "fa-arrow-trend-up",
	milestone: "fa-mountain-sun",
	abandon: "fa-wind",
	limit: "fa-shield",
};

const TRACK_LABEL_KEYS = {
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

	// Improve (max = configured threshold, default 3)
	if (
		attrib === "system.improve.value" &&
		newValue === CONFIG.litmv2.improveThreshold
	) {
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
				actorId: doc.parent?.id ?? actor.id,
				themeId: doc.id,
			};
		}
	}

	return null;
}

/**
 * Detect a track completion and fire `litm.trackCompleted` for it.
 * Use after the track value has already been written (e.g. as part of a
 * composite update); prefer {@link completeTrackUpdate} when the write is a
 * plain single-path set.
 * @param {string} attrib       The attribute path that was updated
 * @param {number} value        The new value
 * @param {Document} doc        The document that was updated (actor or theme item)
 * @param {Actor} owner         The actor owning the track
 * @param {Actor} [notifyActor] Actor for the hook payload, when the completion
 *                              should be attributed to someone other than the
 *                              track owner (e.g. the hero whose Reflect marked
 *                              a fellowship theme)
 * @returns {object|null}       The trackInfo that was fired, or null
 */
export function fireTrackCompletion(attrib, value, doc, owner, notifyActor) {
	const trackInfo = detectTrackCompletion(attrib, value, doc, owner);
	if (trackInfo) {
		Hooks.callAll("litm.trackCompleted", {
			actor: notifyActor ?? owner,
			trackInfo,
		});
	}
	return trackInfo;
}

/**
 * Canonical "mark a track" write: set the value, detect completion, fire
 * `litm.trackCompleted`. Every surface that fills track boxes (sheets,
 * camping, improvements, macros) should go through this so the completion
 * chat card semantics live in one place.
 * @param {Document} doc        The document holding the track (actor or theme item)
 * @param {string} attrib       The attribute path to set
 * @param {number} value        The new value
 * @param {Actor} owner         The actor owning the track
 * @param {Actor} [notifyActor] See {@link fireTrackCompletion}
 * @returns {Promise<object|null>} The trackInfo that was fired, or null
 */
export async function completeTrackUpdate(
	doc,
	attrib,
	value,
	owner,
	notifyActor,
) {
	await doc.update({ [attrib]: value });
	return fireTrackCompletion(attrib, value, doc, owner, notifyActor);
}

const FOOTER_BY_TYPE = {
	improve: {
		click: "open-theme-advancement",
		labelKey: "LITM.Ui.choose_improvement",
		icon: "fa-wand-magic-sparkles",
	},
	milestone: {
		click: "open-theme-evolution",
		labelKey: "LITM.Ui.evolve_theme",
		icon: "fa-mountain-sun",
	},
	abandon: {
		click: "open-theme-evolution",
		labelKey: "LITM.Ui.replace_theme",
		icon: "fa-wind",
	},
};

export async function buildTrackCompleteContent({
	text,
	type,
	actorId,
	themeId,
}) {
	const footer = FOOTER_BY_TYPE[type];
	const hasFooter = !!(footer && actorId && themeId);
	return foundry.applications.handlebars.renderTemplate(
		"systems/litmv2/templates/chat/track-complete.html",
		{
			text,
			type,
			icon: TRACK_ICONS[type],
			label: game.i18n.localize(TRACK_LABEL_KEYS[type]),
			hasFooter,
			actorId,
			themeId,
			footerClick: footer?.click,
			footerLabel: hasFooter ? game.i18n.localize(footer.labelKey) : "",
			footerIcon: footer?.icon,
		},
	);
}
