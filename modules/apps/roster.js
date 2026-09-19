import { localize as t } from "../utils.js";

/**
 * The roster row — the system's one way of asking "which character?".
 *
 * Before this existed, every surface that wanted a character invented its own:
 * the Narrator's Call grew a row of hairline plaques, the target picker used a
 * bare Foundry radio, the camping scene used a `<select>` that threw away the
 * portrait it had already resolved. None of them agreed on how to read a
 * portrait or a name, and none of them looked like the rest of the system.
 *
 * A roster row is a cast list entry: portrait, name, and one line of context
 * under it. The context line is *text*, never a tooltip — who is playing a
 * Hero, and whether they are at the table, has to be readable at a glance by
 * a Narrator deciding who to call on.
 *
 * Two deliberate contracts, because the surveyed surfaces disagreed on both:
 *
 * - **Portrait** falls back through token texture → actor image → Foundry's
 *   mystery-man. Only the roll HUD had a fallback; everywhere else a
 *   portrait-less actor silently lost its left column and the row collapsed.
 * - **Name** is `system.maskedName ?? name`. A concealed Challenge wears its
 *   mask in the target picker today, and a row shape that read `actor.name`
 *   would turn one shared control into a concealment leak.
 *
 * **Presence is opt-in.** It is a property of player-ownable characters, so a
 * Challenge or a Limit must not render a hollow dot and "no player assigned" —
 * that reads as a broken Hero. Only the call-for-roll roster asks for it.
 *
 * No rendering here; `templates/partials/roster-row.html` owns the markup.
 */

/**
 * The portrait for a roster row, with a fallback that always resolves.
 *
 * @param {Actor} actor
 * @returns {string}
 */
export function rosterPortrait(actor) {
	return (
		actor?.prototypeToken?.texture?.src ||
		actor?.img ||
		CONFIG.litmv2?.assets?.icons?.defaultActor ||
		""
	);
}

/**
 * The name for a roster row. Masked where the actor wears a mask.
 *
 * @param {Actor} actor
 * @returns {string}
 */
export function rosterName(actor) {
	return actor?.system?.maskedName ?? actor?.name ?? "";
}

/**
 * Who is playing this character, and are they here.
 *
 * Gamemasters are deliberately not counted as owners: a GM owns every actor,
 * so counting them would report every Hero as played by the Narrator.
 *
 * @param {Actor} actor
 * @returns {{meta: string, online: boolean, unowned: boolean}}
 */
export function rosterPresence(actor) {
	const owners =
		game.users?.filter(
			(u) => !u.isGM && actor?.testUserPermission?.(u, "OWNER"),
		) ?? [];
	const online = owners.filter((u) => u.active);
	if (online.length)
		return {
			meta: online.map((u) => u.name).join(", "),
			online: true,
			unowned: false,
		};
	if (owners.length)
		return {
			meta: t("LITM.Ui.roster_away"),
			online: false,
			unowned: false,
		};
	return { meta: t("LITM.Ui.roster_no_player"), online: false, unowned: true };
}

/**
 * Build one roster row's render context.
 *
 * @param {Actor} actor
 * @param {object} [options]
 * @param {boolean} [options.presence=false] Derive the context line from who
 *                                           owns the actor, and dim the row
 *                                           when nobody is holding it.
 *                                           Player-ownable actors only.
 * @param {boolean} [options.selected=false]
 * @param {string}  [options.value]          Radio value; defaults to the id.
 * @param {string}  [options.inputName="rosterPick"]
 * @param {string}  [options.meta=""]        Context line, when not derived.
 * @param {string}  [options.img]            Portrait override, for callers that
 *                                           already resolved a better one (a
 *                                           placed token's own texture).
 * @param {string}  [options.name]           Name override, same reason.
 * @param {boolean} [options.multi=false]    Checkbox instead of radio, for the
 *                                           surfaces that tick several.
 * @param {string}  [options.variant=""]     Row modifier, e.g. "fellowship".
 * @returns {object}
 */
export function buildRosterEntry(actor, options = {}) {
	const {
		presence = false,
		selected = false,
		multi = false,
		value,
		inputName = "rosterPick",
		meta = "",
		img,
		name,
		variant = "",
	} = options;

	const seat = presence
		? rosterPresence(actor)
		: { meta, online: false, unowned: false };

	return {
		id: actor?.id ?? "",
		actorId: actor?.id ?? "",
		value: value ?? actor?.id ?? "",
		inputName,
		selected,
		img: img || rosterPortrait(actor),
		name: name || rosterName(actor),
		meta: seat.meta,
		muted: presence && !seat.online,
		multi,
		variant,
	};
}
