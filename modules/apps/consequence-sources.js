import { scanMarkup } from "../item/action/action-rules.js";
import { proseChipsHtml } from "../system/renderers/renderer-utils.js";

/**
 * Build the per-consequence view-model shared by the action and contributed
 * paths in the GM consequence menu. `key` is the input/value identity; `index`
 * is the consequence's position within its own source array (used by the
 * submit handler to resolve the text).
 *
 * The display `text` uses the pre-enriched `html` when provided (full
 * enrichHTML — bold, tag chips, links), falling back to the lightweight
 * chips-only `proseChipsHtml`. Variable-tier tokens are always scanned from the
 * RAW `text`, not the enriched HTML.
 *
 * @param {string} text  Raw consequence markup.
 * @param {string} key
 * @param {{index?: number, applied?: boolean, disabled?: boolean,
 *          sourceUuid?: string, sourceLabel?: string, html?: string}} [opts]
 */
export function buildConsequenceItem(
	text,
	key,
	{
		index = 0,
		applied = false,
		disabled = false,
		sourceUuid = "",
		sourceLabel = "",
		html,
	} = {},
) {
	const varTokens = [];
	let v = 0;
	for (const tok of scanMarkup(text)) {
		if (tok.type === "status" && tok.isVariable) {
			varTokens.push({ idx: v, name: tok.name });
			v++;
		}
	}
	return {
		key,
		index,
		text: html ?? proseChipsHtml(text),
		varTokens,
		hasVariableTier: varTokens.length > 0,
		applied,
		disabled,
		sourceUuid,
		sourceLabel,
	};
}

/**
 * Flatten the consequence strings authored on the vignettes of in-sidebar
 * challenge/journey actors into raw records. Pure — callers inject the resolved
 * actor docs (e.g. `StoryTagsStore.resolveTrackedActors().map(t => t.actor)`).
 * Skips blank strings and non-vignette items. `index` is the position within
 * the owning vignette's `system.consequences`.
 *
 * @param {Array<{type: string, items?: Array, name?: string, system?: object}>} actors
 * @returns {Array<{actor: object, vignette: object, text: string, index: number}>}
 */
export function collectSourceConsequences(actors = []) {
	const records = [];
	for (const actor of actors) {
		if (actor?.type !== "challenge" && actor?.type !== "journey") continue;
		const vignettes = actor.items?.filter?.((i) => i.type === "vignette") ?? [];
		for (const vignette of vignettes) {
			const consequences = vignette.system?.consequences ?? [];
			consequences.forEach((text, index) => {
				if (!text?.trim()) return;
				records.push({ actor, vignette, text, index });
			});
		}
	}
	return records;
}

/**
 * Group sidebar challenge/journey consequences for the GM consequence menu:
 * one group per source actor, sub-grouped by vignette. Each item is built via
 * {@link buildConsequenceItem}. Contributed keys (`${uuid}#${index}`) are
 * minted here; they are collision-safe against the action path's bare-integer
 * keys (a uuid-prefixed string is never a bare base-10 integer).
 *
 * Prose is rendered through the injected `enrich(text, doc)` — in production
 * the full `enrichHTML` (so `**bold**`, tag chips, and links all resolve like
 * every other surface); the default is the lightweight chips-only
 * `proseChipsHtml`, which keeps this module synchronous-friendly for tests.
 * Each vignette group also carries its enriched `threat` text, which gives the
 * GM the fiction context for deciding which consequence to apply.
 *
 * @param {{actors?: Array, appliedKeys?: Set<string>, disabled?: boolean,
 *          enrich?: (text: string, doc: object) => (string|Promise<string>)}} [opts]
 * @returns {Promise<Array<{sourceName: string,
 *          vignettes: Array<{label: string, threat: string, items: Array}>}>>}
 */
export async function gatherSidebarConsequences({
	actors = [],
	appliedKeys = new Set(),
	disabled = false,
	enrich,
} = {}) {
	const render = enrich ?? ((text) => proseChipsHtml(text));
	const records = collectSourceConsequences(actors);

	// Enrich all prose up front in parallel — every consequence's text, plus
	// each unique vignette's threat once. enrichHTML is the slow step, so a
	// sequential await per record made this O(n) round-trips on every menu
	// render; Promise.all collapses it to one wait. Grouping below stays
	// synchronous, preserving the source-order of actors / vignettes / items.
	const htmls = await Promise.all(
		records.map(({ text, vignette }) => render(text, vignette)),
	);
	const uniqueVignettes = [
		...new Map(records.map((r) => [r.vignette.uuid, r.vignette])).values(),
	];
	const threats = new Map(
		await Promise.all(
			uniqueVignettes.map(async (v) => [
				v.uuid,
				v.system?.threat ? await render(v.system.threat, v) : "",
			]),
		),
	);

	const groups = new Map();
	records.forEach(({ actor, vignette, text, index }, i) => {
		const key = `${vignette.uuid}#${index}`;
		const item = buildConsequenceItem(text, key, {
			index,
			applied: appliedKeys.has(key),
			disabled,
			sourceUuid: vignette.uuid,
			sourceLabel: actor.system?.publicName ?? actor.name,
			html: htmls[i],
		});
		if (!groups.has(actor)) {
			groups.set(actor, { sourceName: actor.name, vignettes: new Map() });
		}
		const group = groups.get(actor);
		if (!group.vignettes.has(vignette.uuid)) {
			group.vignettes.set(vignette.uuid, {
				label: vignette.name || "",
				threat: threats.get(vignette.uuid),
				items: [],
			});
		}
		group.vignettes.get(vignette.uuid).items.push(item);
	});
	return [...groups.values()].map((g) => ({
		sourceName: g.sourceName,
		vignettes: [...g.vignettes.values()],
	}));
}
