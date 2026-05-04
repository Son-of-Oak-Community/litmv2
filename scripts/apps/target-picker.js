import { localize as t } from "../utils.js";
import { FLAG_LIMIT_TYPES } from "../system/config.js";

const { DialogV2 } = foundry.applications.api;

/**
 * Pick a token (or its actor) from the canvas. If the user has tokens
 * currently targeted, those are preferred. Otherwise a DialogV2 lists scene
 * placeables. Returns the selected token's actor (or `null` if cancelled).
 * @param {object} [options]
 * @param {boolean} [options.allowSelf=false]   Whether to include the rolling actor's own token.
 * @param {Actor|null} [options.exclude=null]   Actor to exclude from the picker.
 * @returns {Promise<Actor|null>}
 */
export async function pickTargetActor({ allowSelf = false, exclude = null } = {}) {
	// Fast path: user has explicit targets
	const targets = [...(game.user.targets ?? [])];
	if (targets.length === 1) {
		const a = targets[0].actor;
		if (a && (allowSelf || a !== exclude)) return a;
	}
	if (targets.length > 1) {
		return _chooseFrom(
			targets.map((tk) => ({
				id: tk.actor?.id ?? tk.id,
				label: tk.actor?.name ?? tk.name,
				img: tk.actor?.img ?? tk.document?.texture?.src,
				actor: tk.actor,
			})).filter((e) => e.actor && (allowSelf || e.actor !== exclude)),
			"LITM.Actions.pick_target",
		);
	}

	const tokens = canvas.tokens?.placeables ?? [];
	const candidates = tokens
		.map((tk) => ({
			id: tk.actor?.id ?? tk.id,
			label: tk.actor?.name ?? tk.name,
			img: tk.actor?.img ?? tk.document?.texture?.src,
			actor: tk.actor,
		}))
		.filter((e) => e.actor && (allowSelf || e.actor !== exclude));

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
	const actors = game.actors.contents.filter((a) => a.testUserPermission(game.user, "OBSERVER"));
	const candidates = [];

	for (const actor of actors) {
		if (actor.type === "challenge") {
			const ownIds = new Set((actor.system.limits ?? []).map((l) => l.id));
			const limits = actor.system.derivedLimits ?? actor.system.limits ?? [];
			for (const l of limits) {
				candidates.push({
					id: `${actor.id}::${l.id}`,
					label: `${actor.name} — ${l.label || t("LITM.Terms.limit")} (${l.value ?? 0}/${l.max ?? "—"})`,
					img: actor.img,
					actor,
					limit: l,
					source: ownIds.has(l.id) ? "system" : "addon",
				});
			}
			continue;
		}
		if (FLAG_LIMIT_TYPES.has(actor.type)) {
			const limits = actor.getFlag("litmv2", "limits") ?? [];
			for (const l of limits) {
				candidates.push({
					id: `${actor.id}::${l.id}`,
					label: `${actor.name} — ${l.label || t("LITM.Terms.limit")} (${l.value ?? 0}/${l.max ?? "—"})`,
					img: actor.img,
					actor,
					limit: l,
					source: "flag",
				});
			}
		}
	}

	if (!candidates.length) {
		ui.notifications.warn(t("LITM.Actions.no_limits_in_scene"));
		return null;
	}

	const picked = await _chooseFrom(candidates, "LITM.Actions.pick_limit");
	if (!picked) return null;
	return { actor: picked.actor, limitId: picked.limit.id, limit: picked.limit, source: picked.source };
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
