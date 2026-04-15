import { StatusTagData } from "../data/active-effects/index.js";

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
 * Convert form tier values to a normalized boolean[6] array.
 * Handles both checkbox-style (array of booleans/nulls) and
 * select-style (array of numeric strings) inputs.
 * @param {Array} [values=[]] Raw tier values from form data
 * @returns {boolean[]} Array of 6 booleans
 */
export function toTiers(values = []) {
	if (!Array.isArray(values)) return new Array(6).fill(false);
	if (
		values.length === 6 &&
		values.some((v) => v === null || v === false)
	) {
		return values.map((v) => v !== null && v !== false && v !== "");
	}
	const tiers = new Array(6).fill(false);
	for (const value of values) {
		const index = Number.parseInt(value, 10) - 1;
		if (Number.isFinite(index) && index >= 0 && index < 6) {
			tiers[index] = true;
		}
	}
	return tiers;
}

/**
 * Parse a quick-add input string into a structured descriptor.
 * - "name:N" or "name:" -> limit with optional max
 * - "name-N" (1-6) -> status with tier
 * - plain text -> tag
 * @param {string} raw  The raw input string (already trimmed)
 * @returns {{ type: "limit"|"status"|"tag", name: string, tier?: number, limitMax?: number|null }|null}
 *   null if the input is empty
 */
export function parseQuickAddInput(raw) {
	if (!raw) return null;

	const limitMatch = raw.match(/^(.+):(\d*)$/);
	if (limitMatch) {
		const name = limitMatch[1].trim();
		const max = limitMatch[2] ? Number(limitMatch[2]) : null;
		return { type: "limit", name, limitMax: max };
	}

	const statusMatch = raw.match(/^(.+)-([1-6])$/);
	if (statusMatch) {
		return {
			type: "status",
			name: statusMatch[1].trim(),
			tier: Number.parseInt(statusMatch[2], 10),
		};
	}

	return { type: "tag", name: raw };
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
		type: isStatus ? "status" : "tag",
		system: e.system,
		isScratched: e.system?.isScratched ?? false,
		isSingleUse: e.system?.isSingleUse ?? false,
		hidden: e.system?.isHidden ?? false,
		limitId: e.system?.limitId ?? null,
		value: isStatus ? (e.system?.currentTier ?? 0) : 1,
		values: isStatus
			? (e.system?.tiers ?? new Array(6).fill(false))
			: new Array(6).fill(false),
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
			.filter((t) => t.type === "status")
			.map((t) => t.values);
		const computedValue = StatusTagData.stackTiers(statusTierArrays);
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
