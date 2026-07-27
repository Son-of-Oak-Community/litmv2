import { getMinSuccessCost } from "../../item/action/action-rules.js";
import { classifyTagStringMatch } from "../../item/action/tag-string.js";
import { makeTagStringRe } from "../config.js";

/**
 * Build the `content` body for a confirmation dialog from a localization key.
 *
 * `game.i18n.format` is a plain `String.replace` — it does no HTML escaping —
 * and DialogV2 renders `content` as raw HTML. Interpolated values here are
 * routinely document names, which players control on their own documents, so
 * every value is escaped. The localized string itself is *not* escaped: that's
 * authored content and may legitimately carry markup.
 *
 * Exists so the escaping has one owner. The audit's root-cause for the XSS
 * cluster was sibling call sites drifting apart — one escaped, the next forgot.
 * @param {string} key      Localization key (or, in tests, a literal template)
 * @param {object} [data]   Values to interpolate; each is escaped
 * @returns {string} `<p>…</p>` ready for DialogV2 `content`
 */
export function dialogContent(key, data = {}) {
	const esc = foundry.utils.escapeHTML;
	const safe = Object.fromEntries(
		Object.entries(data).map(([k, v]) => [k, esc(String(v))]),
	);
	return `<p>${game.i18n.format(key, safe)}</p>`;
}

/**
 * Creates a tag span matching the hero play sheet pattern.
 * @param {string} name - Tag name
 * @param {string} type - Tag CSS class (litm-power_tag, litm-weakness_tag, etc.)
 * @returns {HTMLElement}
 */
export function tagSpan(name, type) {
	const span = document.createElement("span");
	span.classList.add(type);
	span.dataset.text = name;
	span.draggable = true;
	span.textContent = name;
	return span;
}

/**
 * Creates a section divider with a centered label.
 * @param {string} label
 * @returns {HTMLElement}
 */
export function sectionHeader(label) {
	const el = document.createElement("div");
	el.classList.add("litm-render__section-header");
	el.textContent = label;
	return el;
}

/**
 * Bootstrap an actor render card container with optional portrait.
 *
 * Click handling is wired via a delegated body-level listener registered in
 * `Enrichers.register()` — the enriched card lives inside a string returned
 * from `TextEditor.enrichHTML`, so DOM event listeners attached at enrich
 * time would be lost on serialization.
 * @param {Actor} actor
 * @param {string} typeClass - CSS modifier class (e.g. "litm-render--hero")
 * @returns {{ container: HTMLElement, headerText: HTMLElement }}
 */
export function makeActorCard(actor, typeClass) {
	const hasCustomImage = actor.img !== CONFIG.litmv2.assets.icons.defaultActor;

	const container = document.createElement("div");
	container.classList.add(
		"litm",
		"litm-render",
		"litm-render--card",
		typeClass,
	);
	container.dataset.uuid = actor.uuid;
	container.dataset.renderAction = "open-sheet";
	container.dataset.tooltip = game.i18n.localize("LITM.Ui.click_to_view_actor");
	container.setAttribute("role", "button");
	container.setAttribute("tabindex", "0");

	const header = document.createElement("div");
	header.classList.add(`${typeClass}__header`);

	if (hasCustomImage) {
		const img = document.createElement("img");
		img.classList.add(`${typeClass}__portrait`);
		img.src = actor.img;
		header.appendChild(img);
	}

	const headerText = document.createElement("div");
	headerText.classList.add(`${typeClass}__header-text`);

	const title = document.createElement("h3");
	title.classList.add("litm-render__title");
	// Concealed challenges show their alias to non-GM viewers
	title.textContent = actor.system.maskedName ?? actor.name;
	headerText.appendChild(title);

	header.appendChild(headerText);
	container.appendChild(header);

	return { container, headerText };
}

/**
 * Render one tag classification (from `classifyTagStringMatch`) as canonical
 * chip HTML. The single source of truth for chip markup — used by the text
 * enricher and `proseChipsHtml` so every surface draws the same chips.
 *
 *   story    → <span class="litm-tag">name</span>
 *   story!   → <span class="litm-tag litm--single-use">name ✱</span>
 *   status   → <span class="litm-status">name-N</span>
 *              ([name-] → litm--variable-tier, no tier suffix)
 *   limit    → <span class="litm-limit">name <N badge></span>
 *   weakness → <span class="litm-weakness_tag">name <chevron></span>
 *
 * `data-text` doubles as the CSS text-stroke underlay (`content:
 * attr(data-text)`) and the dragstart re-parse source, so it always matches
 * the stroked part of the label; suffixes (✱, limit badge, chevron) render
 * unstroked after it. Kind information the bare name can't carry is encoded
 * in the classes instead (`litm--single-use`, `litm-limit`,
 * `litm-weakness_tag`, `litm-status`) plus `data-value` for a limit's max —
 * the dragstart handler reads those back.
 *
 * @param {ReturnType<typeof classifyTagStringMatch>} c
 * @param {object} [opts]
 * @param {string} [opts.tooltip]  data-tooltip text
 * @param {string} [opts.chevron]  Pre-rendered weakness chevron SVG markup
 * @param {boolean} [opts.scratched]  Story/backpack chip rendered scratched —
 *        adds the `scratched` class and the scratch glyph. Mirrors play-tag.html
 *        but chat-safe: a CSS-masked span, not the inline <svg> Foundry strips
 *        from chat-message content.
 * @returns {string}
 */
export function tagChipHtml(
	c,
	{ tooltip = "", chevron = "", scratched = false } = {},
) {
	const esc = foundry.utils.escapeHTML;
	const tip = tooltip ? ` data-tooltip="${esc(tooltip)}"` : "";
	switch (c.kind) {
		case "weakness":
			return `<span class="litm-weakness_tag" draggable="true"${tip} data-text="${esc(
				c.name,
			)}">${esc(c.name)}${chevron ? ` ${chevron}` : ""}</span>`;
		case "limit": {
			const valueHtml = c.value
				? `<img src="systems/litmv2/assets/media/icons/limit.svg"
						style="height:1.4em;width:1.4em;position:absolute;right:-0.5em;top:-0.05em;z-index:-1;" /> <span
						style="font-style:normal;font-size:inherit;font-weight:600;color:var(--color-light-2);position:relative;top:-0.13em;right:-0.1em;">${esc(
							c.value,
						)}</span>`
				: "";
			// data-value lets the dragstart handler recover the max — data-text
			// must stay the bare name (it underlays the CSS text stroke).
			const value = c.value ? ` data-value="${esc(c.value)}"` : "";
			return `<span class="litm-limit" draggable="true"${tip} data-text="${esc(
				c.name,
			)}"${value}>${esc(c.name)}${valueHtml}</span>`;
		}
		case "status": {
			// c.tier is the normalized tier (0 = variable or out-of-range), so
			// [guard-7] renders as a variable-tier chip rather than a
			// definite-looking "guard-7" that no mechanic backs.
			const label = c.tier ? `${c.name}-${c.tier}` : c.name;
			const cls = c.tier ? "litm-status" : "litm-status litm--variable-tier";
			return `<span class="${cls}" draggable="true"${tip} data-text="${esc(
				label,
			)}">${esc(label)}</span>`;
		}
		default: {
			const base = c.isSingleUse ? "litm-tag litm--single-use" : "litm-tag";
			const cls = scratched ? `${base} scratched` : base;
			const label = c.isSingleUse ? `${c.name} ✱` : c.name;
			// Same scratch glyph the play-tag template draws, but chat-safe: a
			// CSS-masked span (Foundry strips inline <svg> from chat content).
			const mark = scratched
				? ` <span class="litm-tag-scratch" aria-hidden="true"></span>`
				: "";
			return `<span class="${cls}" draggable="true"${tip} data-text="${esc(
				c.name,
			)}">${esc(label)}${mark}</span>`;
		}
	}
}

/**
 * Replace `[name]` / `[name!]` / `[name-N]` / `[name:N]` / `[-name]` bracket
 * markup in free text with inline colored chips via `tagChipHtml`. Returns
 * escaped-HTML suitable for direct insertion (via Handlebars SafeString or
 * innerHTML). Non-markup text is HTML-escaped.
 *
 * @param {string} text
 * @returns {string}
 */
export function proseChipsHtml(text) {
	if (!text) return "";
	const re = makeTagStringRe();
	let out = "";
	let lastIndex = 0;
	for (const match of text.matchAll(re)) {
		const start = match.index;
		if (start > lastIndex)
			out += foundry.utils.escapeHTML(text.slice(lastIndex, start));
		out += tagChipHtml(classifyTagStringMatch(match));
		lastIndex = start + match[0].length;
	}
	if (lastIndex < text.length)
		out += foundry.utils.escapeHTML(text.slice(lastIndex));
	return out;
}

/**
 * Inline cost indicator for an action success — "2 Power", "2+ Power",
 * "1 Power per tier", or "" when free. Shared by the chat-card success list
 * and the Spend Power dialog so both surfaces show the same answer.
 *
 * Narrative (Quick) verbs are free → no label. Successes whose final cost is
 * picked in Spend Power (variable-tier statuses, or 2+ selectable tags) show
 * their minimum with a "+"; when nothing is mandatory ([name-] only), the
 * label spells out the per-tier price instead of a confusing "0+".
 *
 * @param {{ fixed: number, variableTokens: number, tagCosts?: number[] }} cost
 *   From getSuccessCost.
 * @param {object|null} def  Verb definition from getVerbDef.
 * @returns {string}
 */
export function formatCostLabel(cost, def) {
	if (!def || def.kind === "narrative") return "";
	const variable = cost.variableTokens ?? 0;
	const selectableTags = (cost.tagCosts?.length ?? 0) >= 2;
	if (variable > 0 || selectableTags) {
		const min = getMinSuccessCost(cost);
		if (min > 0)
			return game.i18n.format("LITM.Actions.cost_variable", { n: min });
		return game.i18n.localize("LITM.Actions.cost_per_tier");
	}
	if ((cost.fixed ?? 0) <= 0) return "";
	return game.i18n.format("LITM.Actions.cost", { n: cost.fixed });
}
