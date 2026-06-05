import { localize as t } from "../utils.js";

const { DialogV2 } = foundry.applications.api;

/**
 * Build the list of targetable actors — scene tokens first (deduped by
 * actor), falling back to observable sidebar actors so theatre-of-mind
 * sessions aren't gated on token placement. Shared by the picker dialog
 * below and the target chip row in the Spend Power dialog.
 * @param {object} [options]
 * @param {boolean} [options.allowSelf=false]   Whether to include the rolling actor.
 * @param {Actor|null} [options.exclude=null]   Actor to exclude from the list.
 * @returns {object[]}  Entries of `{id, label, img, actor}`.
 */
export function getTargetCandidates({
	allowSelf = false,
	exclude = null,
} = {}) {
	const seen = new Set();
	const candidates = [];
	for (const tk of canvas.tokens?.placeables ?? []) {
		const a = tk.actor;
		if (!a || seen.has(a.id)) continue;
		if (!allowSelf && a === exclude) continue;
		seen.add(a.id);
		candidates.push({
			id: a.id,
			label: a.system?.maskedName ?? a.name,
			img: a.img ?? tk.document?.texture?.src,
			actor: a,
		});
	}
	if (candidates.length) return candidates;

	const TARGETABLE_TYPES = new Set([
		"hero",
		"challenge",
		"journey",
		"fellowship",
		"story_theme",
	]);
	return (game.actors?.contents ?? [])
		.filter((a) => TARGETABLE_TYPES.has(a.type))
		.filter((a) => a.testUserPermission(game.user, "OBSERVER"))
		.filter((a) => allowSelf || a !== exclude)
		.map((a) => ({
			id: a.id,
			label: a.system.maskedName ?? a.name,
			img: a.img,
			actor: a,
		}));
}

/**
 * Pick a token (or its actor) from the canvas. If the user has tokens
 * currently targeted, those are preferred. Otherwise a DialogV2 lists scene
 * placeables, falling back to observable sidebar actors. Returns the
 * selected token's actor (or `null` if cancelled).
 * @param {object} [options]
 * @param {boolean} [options.allowSelf=false]   Whether to include the rolling actor's own token.
 * @param {Actor|null} [options.exclude=null]   Actor to exclude from the picker.
 * @returns {Promise<Actor|null>}
 */
export async function pickTargetActor({
	allowSelf = false,
	exclude = null,
} = {}) {
	// Fast path: user has explicit targets
	const targets = [...(game.user.targets ?? [])];
	if (targets.length === 1) {
		const a = targets[0].actor;
		if (a && (allowSelf || a !== exclude)) return a;
	}
	if (targets.length > 1) {
		return _chooseFrom(
			targets
				.map((tk) => ({
					id: tk.actor?.id ?? tk.id,
					label: tk.actor?.system?.maskedName ?? tk.actor?.name ?? tk.name,
					img: tk.actor?.img ?? tk.document?.texture?.src,
					actor: tk.actor,
				}))
				.filter((e) => e.actor && (allowSelf || e.actor !== exclude)),
			"LITM.Actions.pick_target",
		);
	}

	const candidates = getTargetCandidates({ allowSelf, exclude });
	if (!candidates.length) {
		ui.notifications.warn(t("LITM.Actions.no_targets_in_scene"));
		return null;
	}
	return _chooseFrom(candidates, "LITM.Actions.pick_target");
}

/**
 * Pick a limit on any visible actor (challenges, heroes, fellowship, journey).
 * @returns {Promise<{actor: Actor, limitId: string, limit: object, source: "system"|"flag"}|null>}
 */
export async function pickLimit() {
	const actors = game.actors.contents.filter((a) =>
		a.testUserPermission(game.user, "OBSERVER"),
	);
	const candidates = [];

	for (const actor of actors) {
		if (typeof actor.system?.limits === "undefined") continue;
		const limits = actor.system.limits ?? [];
		if (!limits.length) continue;

		// For challenge actors, derive source from whether the id exists in the
		// canonical (non-addon) schema field. Other actor types are always "flag".
		const isChallenge = actor.type === "challenge";
		const ownIds = isChallenge
			? new Set((actor.system._source?.limits ?? []).map((l) => l.id))
			: null;

		for (const l of limits) {
			const source = isChallenge
				? ownIds.has(l.id)
					? "system"
					: "addon"
				: "flag";
			candidates.push({
				id: `${actor.id}::${l.id}`,
				label: `${actor.system.maskedName ?? actor.name} — ${l.label || t("LITM.Terms.limit")} (${l.value ?? 0}/${l.max ?? "—"})`,
				img: actor.img,
				actor,
				limit: l,
				source,
			});
		}
	}

	if (!candidates.length) {
		ui.notifications.warn(t("LITM.Actions.no_limits_in_scene"));
		return null;
	}

	const picked = await _chooseFrom(candidates, "LITM.Actions.pick_limit");
	if (!picked) return null;
	return {
		actor: picked.actor,
		limitId: picked.limit.id,
		limit: picked.limit,
		source: picked.source,
	};
}

/**
 * Generic single-choice picker dialog. Returns the chosen entry's `actor`
 * (or full entry for limit picks).
 */
async function _chooseFrom(entries, titleKey) {
	if (entries.length === 1) {
		// Skip the dialog when only one candidate
		return _resolveEntryShape(entries[0]);
	}

	const content = await foundry.applications.handlebars.renderTemplate(
		"systems/litmv2/templates/apps/target-picker-form.html",
		{ entries },
	);

	try {
		const idx = await DialogV2.prompt({
			window: { title: t(titleKey) },
			classes: ["litm", "litm--picker"],
			content,
			ok: {
				label: t("LITM.Actions.pick_confirm"),
				callback: (_event, button) => {
					const form = button.form;
					const checked = form?.querySelector("input[name='picked']:checked");
					return checked ? Number(checked.value) : null;
				},
			},
			rejectClose: false,
		});
		if (idx == null) return null;
		return _resolveEntryShape(entries[idx]);
	} catch {
		return null;
	}
}

function _resolveEntryShape(entry) {
	// For token-pick, callers expect just the actor.
	// For limit-pick, callers want the full entry — but they call pickLimit which already wraps.
	// So this returns the actor by default; pickLimit unwraps via .limit.
	return entry.limit ? entry : entry.actor;
}
