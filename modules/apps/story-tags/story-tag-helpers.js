import {
	maxStatusTier,
	padTiers,
	StatusTagData,
} from "../../active-effects/index.js";
import { classifyTagString } from "../../item/action/tag-string.js";

/**
 * Validate and normalize a raw story-tags config object.
 * Ensures all actor IDs are valid Actor UUIDs, normalizes legacy bare IDs,
 * prunes hidden actors that no longer exist in the actors list.
 * @param {object} raw  The raw config from settings
 * @returns {{ config: object, changed: boolean }}
 */
export function normalizeConfig(raw) {
	const validated = (raw.actors || []).map(toValidUuid);
	const validatedHidden = (raw.hiddenActors || []).map(toValidUuid);
	const actorSet = new Set(validated.map((a) => a.id).filter(Boolean));
	const hiddenIds = validatedHidden
		.map((a) => a.id)
		.filter((id) => id && actorSet.has(id));
	const hiddenPruned =
		hiddenIds.length !== validatedHidden.filter((a) => a.id).length;

	const changed =
		[...validated, ...validatedHidden].some((a) => a.changed) || hiddenPruned;

	if (!changed) return { config: raw, changed: false };

	const config = {
		...raw,
		actors: validated.map((a) => a.id).filter(Boolean),
		hiddenActors: hiddenIds,
		tags: Array.isArray(raw.tags) ? raw.tags : [],
		limits: Array.isArray(raw.limits) ? raw.limits : [],
	};
	return { config, changed: true };
}

/**
 * Validate a single actor ID/UUID, normalizing legacy bare IDs.
 * @param {string} id
 * @returns {{ id: string|null, changed: boolean }}
 */
function toValidUuid(id) {
	const trimmed = typeof id === "string" && id.trim();
	const parsed = foundry.utils.parseUuid(trimmed);

	switch (true) {
		case !trimmed:
			return { id: null, changed: true };
		case !parsed?.collection:
			return game.actors?.has(trimmed)
				? { id: `Actor.${trimmed}`, changed: true }
				: { id: null, changed: true };
		case parsed.type === "Token": {
			const doc = foundry.utils.fromUuidSync(trimmed, { strict: false });
			if (!doc?.actor) return { id: null, changed: true };
			return { id: doc.actor.uuid, changed: true };
		}
		case parsed.type !== "Actor":
			return { id: null, changed: true };
		case trimmed !== id:
			return { id: trimmed, changed: true };
		default:
			return { id, changed: false };
	}
}

/**
 * Convert form tier values to a normalized boolean array of the world's track
 * depth. Handles both checkbox-style (array of booleans/nulls) and
 * select-style (array of numeric strings) inputs.
 * @param {Array} [values=[]] Raw tier values from form data
 * @returns {boolean[]}
 */
export function toTiers(values = []) {
	const length = maxStatusTier();
	if (!Array.isArray(values)) return new Array(length).fill(false);
	// Checkbox-style: one entry per box, already the track's own length.
	if (
		values.length >= length &&
		values.some((v) => v === null || v === false)
	) {
		return values.map((v) => v !== null && v !== false && v !== "");
	}
	const tiers = new Array(length).fill(false);
	for (const value of values) {
		const index = Number.parseInt(value, 10) - 1;
		if (Number.isFinite(index) && index >= 0 && index < length) {
			tiers[index] = true;
		}
	}
	return tiers;
}

/**
 * Parse a quick-add input string into a structured descriptor. The input is
 * the bracket tag-string syntax minus the brackets, so parsing wraps the raw
 * text in `[…]` and delegates to the canonical classifier — quick-add and
 * bracket markup can't drift apart.
 * - "name:N" or "name:" -> limit with optional max
 * - "name-N" -> status_tag with tier (out-of-range tier -> tier-less status)
 * - "name!" -> single-use story_tag
 * - plain text -> story_tag
 * @param {string} raw  The raw input string (already trimmed)
 * @returns {{ type: "limit"|"status_tag"|"story_tag", name: string, tier?: number, limitMax?: number|null, isSingleUse?: boolean }|null}
 *   null if the input is empty
 */
export function parseQuickAddInput(raw) {
	if (!raw) return null;

	// Brackets in the input would make the wrapped string parse as a shorter
	// token than what the user typed — treat such input as a literal name.
	const [c] = /[[\]]/.test(raw) ? [] : classifyTagString(`[${raw}]`);
	switch (c?.kind) {
		case "limit":
			return {
				type: "limit",
				name: c.name.trim(),
				limitMax: c.value ? Number(c.value) : null,
			};
		case "status":
			return { type: "status_tag", name: c.name.trim(), tier: c.tier };
		case "story":
			return {
				type: "story_tag",
				name: c.name.trim(),
				isSingleUse: c.isSingleUse,
			};
		default:
			// Weakness markup ("-name") and names the bracket grammar can't
			// express land here.
			return parseUnbracketableInput(raw);
	}
}

/**
 * Fallback for quick-add input the bracket grammar rejects — chiefly names
 * containing digits: the canonical regex bans digits in names (that's what
 * splits `[wounded-3]` into name + tier), so `[room 2:4]` never matches. But
 * quick-add has no such parsing constraint — "room 2:4" is a fine limit name.
 * Mirror the canonical suffix semantics on the raw text, conservatively:
 * status tiers stay within the world's track depth here ("level 2-9" is a
 * name, not a status — unless the world's tracks really do run to 9).
 * Weakness markup ("-name") also falls through to the literal story tag —
 * quick-add can't create weakness effects.
 */
function parseUnbracketableInput(raw) {
	const limit = raw.match(/^(.+):(\d*)$/);
	if (limit) {
		return {
			type: "limit",
			name: limit[1].trim(),
			limitMax: limit[2] ? Number(limit[2]) : null,
		};
	}
	const status = raw.match(/^(.+)-(\d+)$/);
	if (status) {
		const tier = Number.parseInt(status[2], 10);
		if (tier >= 1 && tier <= maxStatusTier()) {
			return { type: "status_tag", name: status[1].trim(), tier };
		}
	}
	const singleUse = raw.match(/^(.+)!$/);
	if (singleUse) {
		return { type: "story_tag", name: singleUse[1].trim(), isSingleUse: true };
	}
	return { type: "story_tag", name: raw };
}

/**
 * Map an ActiveEffect to a flat UI descriptor for the story tag sidebar.
 * Works with both compendium pack AEs (using _id) and actor AEs (using id).
 * @param {ActiveEffect} e  The effect to map
 * @returns {object} Flat UI object for template rendering
 */
export function mapEffectForUI(e) {
	const isStatus = e.type === "status_tag";
	return {
		id: e._id ?? e.id,
		uuid: e.uuid,
		name: e.name,
		type: e.type,
		system: e.system,
		isScratched: e.system?.isScratched ?? false,
		isSingleUse: e.system?.isSingleUse ?? false,
		hidden: e.system?.isHidden ?? false,
		limitId: e.system?.limitId ?? null,
		value: isStatus ? (e.system?.currentTier ?? 0) : 1,
		values: isStatus ? padTiers(e.system?.tiers) : [],
	};
}

/**
 * Partition tags into limit groups and ungrouped remainders.
 * Computes stacked tier values for each limit group.
 * @param {object[]} tags   Flat tag UI descriptors (from mapEffectForUI)
 * @param {object[]} limits Limit objects with at least `id` and `max`
 * @returns {{ limits: object[], ungroupedTags: object[] }}
 */
export function partitionTagsByLimit(tags, limits) {
	const groupedLimits = limits.map((limit) => {
		const groupedTags = tags.filter((t) => t.limitId === limit.id);
		const statusTierArrays = groupedTags
			.filter((t) => t.type === "status_tag")
			.map((t) => t.values);
		const computedValue = StatusTagData.stackedTier(statusTierArrays);
		return { ...limit, tags: groupedTags, computedValue };
	});
	const groupedIds = new Set(
		groupedLimits.flatMap((l) => l.tags.map((t) => t.id)),
	);
	const ungroupedTags = tags.filter((t) => !groupedIds.has(t.id));
	return { limits: groupedLimits, ungroupedTags };
}

/**
 * Disambiguate duplicate actor names by appending a numbered suffix.
 * Mutates the `name` property on actors with duplicate names.
 * @param {object[]} actors  Actor descriptor objects with at least `name`
 */
export function disambiguateNames(actors) {
	const nameCounts = new Map();
	for (const actor of actors) {
		nameCounts.set(actor.name, (nameCounts.get(actor.name) ?? 0) + 1);
	}
	const nameIndex = new Map();
	for (const actor of actors) {
		if (nameCounts.get(actor.name) > 1) {
			const i = (nameIndex.get(actor.name) ?? 0) + 1;
			nameIndex.set(actor.name, i);
			actor.name = `${actor.name} (${i})`;
		}
	}
}
