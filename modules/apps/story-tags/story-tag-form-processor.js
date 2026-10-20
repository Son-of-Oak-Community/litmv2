/**
 * Form-data processing for the story-tag sidebar submit handler. Three
 * stages, each addressing a distinct slice of the form:
 *
 *   - `applyActorTagUpdates` writes tag/status effect updates back to each
 *     contributing actor (heroes, fellowships, etc).
 *   - `buildStoryTagUpdates` builds the update plan for the world-level
 *     story-tag compendium pack. Pure transform — caller decides whether
 *     to apply via `ContentSources.updateStoryTags` or broadcast as a
 *     player-side `updateTags` socket request.
 *   - `applyLimitUpdates` handles both world-scoped story limits and
 *     per-actor flag limits (hero / journey).
 *
 * Each impure stage takes a `resolveActor(id)` callback so the sidebar can
 * supply its existing UUID-or-id resolution logic without this module
 * having to know the membership rules.
 *
 * The sidebar submits the whole form on any change, so every stage also takes
 * the form's render-time values (`rendered`, shaped like the submitted data)
 * and sends only the fields that differ from them. The comparison is against
 * the form's own render, never the live documents: a row the user did not
 * touch still holds whatever the form was rendered with, which differs from
 * live exactly when somebody else changed it since, and sending that would
 * write their change away. A row missing from `rendered` can't be proven
 * untouched, so it is sent whole.
 */

import { updateEffectsByParent } from "../../active-effects/effect-factories.js";
import { FLAG_LIMIT_TYPES } from "../../system/config.js";
import { toTiers } from "./story-tag-helpers.js";

/**
 * The tier boxes of a status row as a boolean track. FormDataExtended hands a
 * lone checkbox over as a scalar, so wrap it before `toTiers` reads it.
 * @param {*} values  Raw `values` field of a form row
 * @returns {boolean[]}
 */
function formTiers(values) {
	const raw = Array.isArray(values) ? values : values != null ? [values] : [];
	return toTiers(raw);
}

/** `obj` without its undefined entries — "no change" is the absence of a key. */
const defined = (obj) =>
	Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const sameTiers = (a, b) =>
	a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The fields of one submitted row that differ from the row the form was
 * rendered with, already normalized the way they are written. A tier track is
 * compared and returned whole. Names are compared as typed, because that is
 * also what gets written; trimming only on the way in would swallow a
 * whitespace-only edit that used to land.
 *
 * @param {object} data       The submitted row
 * @param {object} [rendered] The same row as the form was rendered, if known
 * @returns {{ name?: string, tiers?: boolean[], isScratched?: boolean, isSingleUse?: boolean, limitId?: string|null }}
 */
function changedRowFields(data, rendered) {
	const differs = (now, was) => !rendered || now !== was;
	const changed = {};

	if (differs(data.name, rendered?.name)) changed.name = data.name;

	if (data.tagType === "status_tag") {
		const tiers = formTiers(data.values);
		if (!rendered || !sameTiers(tiers, formTiers(rendered.values))) {
			changed.tiers = tiers;
		}
	} else {
		const isScratched = !!data.isScratched;
		if (differs(isScratched, !!rendered?.isScratched)) {
			changed.isScratched = isScratched;
		}
		const isSingleUse = !!data.isSingleUse;
		if (differs(isSingleUse, !!rendered?.isSingleUse)) {
			changed.isSingleUse = isSingleUse;
		}
	}

	if (data.limitId !== undefined) {
		const limitId = data.limitId || null;
		if (differs(limitId, rendered?.limitId || null)) changed.limitId = limitId;
	}

	return changed;
}

/**
 * Write tag and status effect updates back to their owning actors.
 *
 * @param {Record<string, Record<string, object>>} actors  `{ [actorId]: { [effectId]: formFields } }`
 * @param {(id: string) => Actor|null} resolveActor
 * @param {Record<string, Record<string, object>>} [rendered]  The same shape, as the form was rendered
 * @returns {Promise<string[]>} The ids (keys of `actors`) of the actors it wrote to
 */
export async function applyActorTagUpdates(
	actors,
	resolveActor,
	rendered = {},
) {
	const touched = [];
	for (const [actorId, tags] of Object.entries(actors)) {
		const actor = resolveActor(actorId);
		if (!actor?.isOwner) continue;

		const updates = [];
		for (const [effectId, data] of Object.entries(tags)) {
			const changed = changedRowFields(data, rendered?.[actorId]?.[effectId]);
			const system = defined(
				data.tagType === "status_tag"
					? { tiers: changed.tiers }
					: {
							isScratched: changed.isScratched,
							isSingleUse: changed.isSingleUse,
							limitId: changed.limitId,
						},
			);
			const update = defined({
				_id: effectId,
				name: changed.name,
				system: Object.keys(system).length ? system : undefined,
			});
			if (Object.keys(update).length > 1) updates.push(update);
		}

		if (!updates.length) continue;
		await updateEffectsByParent(actor, updates);
		touched.push(actorId);
	}
	return touched;
}

/**
 * Build update objects for the story-tag compendium pack.
 *
 * @param {Record<string, object>} [story]  `{ [tagId]: formFields }`
 * @param {Record<string, object>} [rendered]  The same shape, as the form was rendered
 * @returns {object[]}
 */
export function buildStoryTagUpdates(story, rendered = {}) {
	const updates = [];
	for (const [tagId, data] of Object.entries(story || {})) {
		const changed = changedRowFields(data, rendered?.[tagId]);
		const update = defined({
			_id: tagId,
			name: changed.name,
			"system.tiers": changed.tiers,
			"system.isScratched": changed.isScratched,
			"system.isSingleUse": changed.isSingleUse,
			"system.limitId": changed.limitId,
		});
		if (Object.keys(update).length > 1) updates.push(update);
	}
	return updates;
}

/**
 * Apply the edited `fields` of one submitted limit to its live counterpart.
 * A field the user did not edit (it still matches the render) or that already
 * matches live keeps the live value. Values are compared as strings because a
 * form submits `max` as text while a stored limit may hold a number.
 *
 * @param {object} limit              The live limit
 * @param {object} [formLimit]        The submitted limit
 * @param {object} [renderedLimit]    The limit as the form was rendered
 * @param {string[]} fields           The fields the form may edit
 * @returns {object} `limit` itself when nothing changed, else a copy with the edits
 */
function withEditedLimitFields(limit, formLimit, renderedLimit, fields) {
	if (!formLimit) return limit;
	// The max box renders empty (placeholder "~") for "no maximum", so an
	// empty max means 0 — on both sides, or an untouched row would diff.
	const read = (source, field) =>
		field === "max" && source?.[field] === "" ? 0 : source?.[field];
	const edits = {};
	for (const field of fields) {
		const value = read(formLimit, field);
		if (value == null) continue;
		if (renderedLimit && String(value) === String(read(renderedLimit, field)))
			continue;
		if (String(value) === String(limit[field])) continue;
		edits[field] = value;
	}
	return Object.keys(edits).length ? { ...limit, ...edits } : limit;
}

/**
 * Process limit form data for both story-scoped limits and per-actor flag
 * limits. Applies the per-actor writes in parallel and returns the new
 * story-limits array so the caller can persist it in one settings write.
 *
 * @param {object} [limitsData]               `{ story: {...}, [actorId]: {...} }`
 * @param {object[]} [currentStoryLimits]     The current world story-limits array
 * @param {(id: string) => Actor|null} resolveActor
 * @param {object} [rendered]                 `limitsData` as the form was rendered
 * @returns {Promise<{ storyLimits: object[]|null, flagLimitsWritten: boolean }>}
 *   `storyLimits` is the new story-limits array, or `null` when no story
 *   limit changed and there is nothing to persist.
 */
export async function applyLimitUpdates(
	limitsData,
	currentStoryLimits,
	resolveActor,
	rendered = {},
) {
	const result = { storyLimits: null, flagLimitsWritten: false };
	if (!limitsData || !game.user.isGM) return result;

	// Story limits — GM-owned world-level
	const storyLimitsData = limitsData.story;
	if (storyLimitsData) {
		const current = currentStoryLimits ?? [];
		const next = current.map((limit) =>
			withEditedLimitFields(
				limit,
				storyLimitsData[limit.id],
				rendered?.story?.[limit.id],
				["label", "max"],
			),
		);
		if (next.some((limit, i) => limit !== current[i]))
			result.storyLimits = next;
	}

	// Actor limits: flag-backed (hero / journey) and a Challenge's
	// `system.limits`; `setLimits` routes each to its store.
	const flagUpdates = [];
	for (const [source, sourceLimits] of Object.entries(limitsData)) {
		if (source === "story") continue;
		const actor = resolveActor(source);
		if (!actor?.isOwner) continue;
		if (!FLAG_LIMIT_TYPES.has(actor.type) && actor.type !== "challenge")
			continue;
		const existing = actor.system.limits;
		const fields = actor.type === "hero" ? ["label"] : ["label", "max"];
		const updated = existing.map((limit) =>
			withEditedLimitFields(
				limit,
				sourceLimits[limit.id],
				rendered?.[source]?.[limit.id],
				fields,
			),
		);
		if (updated.some((limit, i) => limit !== existing[i])) {
			flagUpdates.push(actor.system.setLimits(updated));
		}
	}
	await Promise.all(flagUpdates);
	result.flagLimitsWritten = flagUpdates.length > 0;

	return result;
}
