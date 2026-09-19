import { localize as t } from "../utils.js";
import { buildRosterEntry } from "./roster.js";
import { StoryTagsStore } from "./story-tags/story-tags-store.js";

const { DialogV2 } = foundry.applications.api;

/**
 * Build the list of targetable actors: everyone in play. That is the union of
 * the scene's tokens and the story-tag sidebar's tracked actors — the latter so
 * theatre-of-mind sessions aren't gated on token placement, and so token-less
 * entities (the fellowship, story themes) stay targetable in a tokened scene.
 *
 * The world actor directory is deliberately *not* a source: a content module's
 * story-theme library would flood every picker with actors that were never in
 * play. Sidebar visibility rules carry over — hidden columns stay GM-only and
 * concealed challenges wear their mask.
 *
 * Shared by the picker dialog below, the Apply Consequences target chips and
 * the Spend Power dialog's target/scratch/reduce/inflict pickers.
 * @param {object} [options]
 * @param {boolean} [options.allowSelf=false]   Whether to include the rolling actor.
 * @param {Actor|null} [options.exclude=null]   Actor to exclude from the list.
 * @param {string[]|null} [options.types=null]  Restrict to these actor types (default: any).
 * @returns {object[]}  Entries of `{id, label, img, actor}`.
 */
export function getTargetCandidates({
	allowSelf = false,
	exclude = null,
	types = null,
} = {}) {
	const allowedTypes = types ? new Set(types) : null;
	const tracked = StoryTagsStore.resolveTrackedActors();
	const hiddenActorIds = StoryTagsStore.concealedActorIds;
	const seen = new Set();
	const candidates = [];

	const add = (actor, img) => {
		if (!actor || seen.has(actor.id)) return;
		if (!allowSelf && actor === exclude) return;
		if (allowedTypes && !allowedTypes.has(actor.type)) return;
		// Checked here rather than per source: an actor hidden in the sidebar is
		// hidden however it is reached, including through a token on the scene.
		if (hiddenActorIds.has(actor.id)) return;
		seen.add(actor.id);
		candidates.push({
			id: actor.id,
			label: actor.system?.maskedName ?? actor.name,
			img,
			actor,
		});
	};

	// Scene tokens first; a token's texture stands in for a portrait-less actor.
	for (const tk of canvas.tokens?.placeables ?? []) {
		// A GM-hidden token isn't in play as far as its players are concerned.
		if (!game.user.isGM && tk.document?.hidden) continue;
		add(tk.actor, tk.actor?.img ?? tk.document?.texture?.src);
	}

	for (const { actor } of tracked) add(actor, actor.img);

	return candidates;
}

/**
 * Pick an actor to act on. If the user has tokens currently targeted, those
 * are preferred. Otherwise a DialogV2 lists everyone in play — see
 * {@link getTargetCandidates} for what that means. Returns the selected
 * actor (or `null` if cancelled).
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
				label: actor.system.maskedName ?? actor.name,
				// The limit is the row's context line. It used to be crammed into
				// the label behind an em-dash; a roster row has a second line for
				// exactly this.
				meta: `${l.label || t("LITM.Terms.limit")} (${l.value ?? 0}/${l.max ?? "—"})`,
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

	// Presence is deliberately off here: this picker lists Challenges, Story
	// Themes and Limits as well as Heroes, and a Challenge wearing a hollow
	// "no player assigned" dot would read as a broken character.
	const rows = entries.map((entry, index) =>
		buildRosterEntry(entry.actor, {
			value: index,
			inputName: "picked",
			selected: index === 0,
			img: entry.img,
			name: entry.label,
			meta: entry.meta ?? "",
		}),
	);

	const content = await foundry.applications.handlebars.renderTemplate(
		"systems/litmv2/templates/apps/target-picker-form.html",
		{ entries: rows },
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
