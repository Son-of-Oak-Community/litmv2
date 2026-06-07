/**
 * Tag-string parsing utilities — the single semantic layer for bracket tag
 * markup. The tag-string format is what users type into a description box
 * (or what an addon item declares in `system.tags`) to produce a tag at
 * runtime. Used by:
 *   - the text enricher in modules/system/enrichers.js
 *   - the addon-effect sync in modules/system/hooks/item-hooks.js
 *   - the chip drag handlers (ui-hooks, StoryTagSidebar)
 *   - the renderer-utils chip pipeline
 *   - the Challenge/Journey tag-string sync mixin
 *
 * The format:
 *   [name]            → story tag
 *   [name!]           → single-use story tag
 *   [name-tier]       → status with that tier marked ([name-] = variable tier)
 *   [name:N]          → limit with max N ([name:] = unbounded)
 *   [-name]           → weakness
 *
 * Names cannot contain digits — the digit exclusion is what lets the regex
 * split `[wounded-3]` into name + tier, so `[level 2]` is not valid markup
 * and renders as plain text.
 *
 * The regex producing the match lives at CONFIG.litmv2.tagStringRe.
 *
 * Weakness and limit markup renders styled chips and carries drag payloads,
 * but produces no ActiveEffect here — there is no "limit" effect type
 * (limits live as fields on actor data models), and weakness effects are
 * created only by the theme/story_theme sheet drop handler.
 * `parseTagStringMatch` returns `null` for both.
 */

import { makeTagStringRe } from "../../system/config.js";

/** The world-configurable tag regex, falling back to the built-in source. */
function tagStringRe() {
	return globalThis.CONFIG?.litmv2?.tagStringRe ?? makeTagStringRe();
}

/**
 * Classify a tag-string regex match into the canonical semantic shape. This
 * is the ONLY place that destructures the match — hand-rolling the
 * `[full, name, exclamation, separator, value]` capture order is bug-prone
 * (the `exclamation` group is easy to forget, which shifts separator/value
 * by one and silently downgrades `[name-tier]` statuses to plain story tags).
 *
 * @param {RegExpMatchArray} match  A match from CONFIG.litmv2.tagStringRe
 * @returns {{
 *   kind: "story" | "status" | "limit" | "weakness",
 *   name: string,
 *   tier: number,
 *   value: string|undefined,
 *   isSingleUse: boolean,
 * }} `name` is cleaned (weakness dash stripped); `tier` is status-only
 *   (1–6, 0 = variable or out-of-range); `value` is the raw numeric string
 *   (status tier / limit max); `isSingleUse` is story-only (`[name!]`).
 */
export function classifyTagStringMatch(match) {
	const [, rawName, exclamation, separator, value] = match;
	if (rawName.startsWith("-")) {
		return {
			kind: "weakness",
			name: rawName.replace(/^-/, ""),
			tier: 0,
			value: undefined,
			isSingleUse: false,
		};
	}
	if (separator === ":") {
		return { kind: "limit", name: rawName, tier: 0, value, isSingleUse: false };
	}
	if (separator === "-") {
		const raw = Number.parseInt(value, 10) || 0;
		const tier = raw >= 1 && raw <= 6 ? raw : 0;
		return { kind: "status", name: rawName, tier, value, isSingleUse: false };
	}
	return {
		kind: "story",
		name: rawName,
		tier: 0,
		value: undefined,
		isSingleUse: exclamation === "!",
	};
}

/**
 * Convert a tag-string regex match into ActiveEffect creation data.
 * Weakness and limit markup has no effect representation and returns `null`.
 * @param {RegExpMatchArray} match  A match from CONFIG.litmv2.tagStringRe
 * @returns {{ name: string, type: string, system: object }|null}
 */
export function parseTagStringMatch(match) {
	const c = classifyTagStringMatch(match);
	switch (c.kind) {
		case "status":
			return {
				name: c.name,
				type: "status_tag",
				system: {
					tiers: Array.from({ length: 6 }, (_, i) => i + 1 === c.tier),
				},
			};
		case "story":
			return {
				name: c.name,
				type: "story_tag",
				system: { isScratched: false, isSingleUse: c.isSingleUse },
			};
		default:
			return null;
	}
}

/**
 * Classify every tag token in a free-text string.
 * @param {string} text
 * @returns {ReturnType<typeof classifyTagStringMatch>[]}
 */
export function classifyTagString(text) {
	if (!text) return [];
	return Array.from(text.matchAll(tagStringRe()), classifyTagStringMatch);
}

/**
 * Parse every tag token in a free-text string into ActiveEffect creation
 * data. Weakness/limit tokens are filtered out.
 * @param {string} text
 * @returns {Array<{ name: string, type: string, system: object }>}
 */
export function parseTagString(text) {
	if (!text) return [];
	return Array.from(text.matchAll(tagStringRe()), parseTagStringMatch).filter(
		Boolean,
	);
}

/** Drag-payload `type` per classification kind. */
const DRAG_TYPES = {
	story: "story_tag",
	status: "status_tag",
	limit: "limit",
	weakness: "weakness_tag",
};

/**
 * Build the canonical chip drag payload from a classification. Shared by the
 * global chip dragstart handler (ui-hooks) and the StoryTagSidebar so every
 * dragged tag carries the same shape.
 * @param {ReturnType<typeof classifyTagStringMatch>} c
 * @param {object} [extras]  Caller-specific fields (sourceActorId, sourceId, …)
 * @returns {object}
 */
export function tagDragData(c, extras = {}) {
	return {
		id: foundry.utils.randomID(),
		name: c.name,
		type: DRAG_TYPES[c.kind] ?? "story_tag",
		values: Array(6)
			.fill(null)
			.map((_, i) => (Number.parseInt(c.value, 10) === i + 1 ? c.value : null)),
		isScratched: false,
		isSingleUse: !!c.isSingleUse,
		value: c.value,
		...extras,
	};
}
