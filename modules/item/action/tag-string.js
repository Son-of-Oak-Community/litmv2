/**
 * Tag-string parsing utilities. The tag-string format is what users type into
 * a description box (or what an addon item declares in `system.tags`) to
 * produce a tag at runtime. Used by:
 *   - the addon-effect sync in modules/system/hooks/item-hooks.js
 *   - the story-tag drop handler in StoryTagSidebar
 *   - the renderer-utils chip pipeline
 *
 * The format supports two shapes:
 *   [name]            → story_tag
 *   [name!]           → single-use story_tag (Action Grimoire convention)
 *   [name:1]          → single-use story_tag (legacy Core Book p.165)
 *   [name-tier]       → status_tag with that tier marked
 *
 * The regex producing the match lives at CONFIG.litmv2.tagStringRe.
 *
 * Note: weakness and limit semantics are *enricher-only*. The enricher
 * renders [-name] as a weakness chip and [name:N] (for N != 1) as a limit
 * chip, but neither shape produces a matching ActiveEffect here:
 *   - [-name] still matches the regex (name = "-name") and would fall into
 *     the story_tag branch below; callers using this parser should filter
 *     such matches out. Weakness ActiveEffects are created only by the
 *     theme/story_theme sheet drop handler when a weakness chip is dragged
 *     onto a sheet.
 *   - [name:N] is parsed as a story_tag (single-use when N === "1", per
 *     the legacy Core Book p.165 convention). There is no "limit"
 *     ActiveEffect type — limits live as fields on actor data models.
 */

/**
 * Lightweight classification of a tag-string match, for callers that diff
 * effects against a string or build drag payloads rather than create full
 * ActiveEffect data. Mirrors the capture-group order of
 * `CONFIG.litmv2.tagStringRe`: `[full, name, exclamation, separator, value]`.
 *
 * Hand-rolling this destructuring is bug-prone — the `exclamation` group is
 * easy to forget, which shifts `separator`/`value` by one and silently
 * downgrades `[name-tier]` statuses to plain story tags. Use this helper
 * instead of re-destructuring the match.
 *
 * @param {RegExpMatchArray} match  A match from CONFIG.litmv2.tagStringRe
 * @returns {{ name: string, isStatus: boolean, tier: number, value: string|undefined }}
 */
export function classifyTagStringMatch(match) {
	const [, name, , separator, value] = match;
	return {
		name,
		isStatus: separator === "-",
		tier: Number.parseInt(value, 10) || 0,
		value,
	};
}

/**
 * Convert a tag-string regex match into ActiveEffect creation data.
 * @param {RegExpMatchArray} match  A match from CONFIG.litmv2.tagStringRe
 * @returns {{ name: string, type: string, system: object }}
 */
export function parseTagStringMatch(match) {
	const [, name, exclamation, separator, value] = match;
	const isStatus = separator === "-";
	if (isStatus) {
		const tier = Number.parseInt(value, 10) || 0;
		return {
			name,
			type: "status_tag",
			system: { tiers: Array.from({ length: 6 }, (_, i) => i + 1 === tier) },
		};
	}
	const isSingleUse =
		exclamation === "!" || (separator === ":" && value === "1");
	return {
		name,
		type: "story_tag",
		system: { isScratched: false, isSingleUse },
	};
}
