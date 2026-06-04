import { StatusTagData } from "../../active-effects/status-tag-data.js";
import { parseTagStringMatch } from "../../item/action/tag-string.js";
import { makeTagStringRe } from "../config.js";

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
 * Replace `[name]` / `[name-N]` / `[name-]` / `[name!]` bracket markup in free
 * text with inline colored chips — yellow for story tags, green for statuses,
 * matching the Action Grimoire's visual convention. Returns escaped-HTML
 * suitable for direct insertion (via Handlebars SafeString or innerHTML).
 *
 *   [map]        → <span class="litm-power_tag">map</span>
 *   [map!]       → <span class="litm-power_tag litm--single-use">map ✱</span>
 *   [wounded-2]  → <span class="litm-status">wounded-2</span>
 *   [wounded-]   → <span class="litm-status litm--variable-tier">wounded</span>
 *
 * Non-markup text is HTML-escaped.
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
		const end = start + match[0].length;
		if (start > lastIndex)
			out += foundry.utils.escapeHTML(text.slice(lastIndex, start));

		const data = parseTagStringMatch(match);
		let cls;
		let label;
		if (data.type === "status_tag") {
			const tier = StatusTagData.tierOf(data.system.tiers);
			cls = tier > 0 ? "litm-status" : "litm-status litm--variable-tier";
			label = tier > 0 ? `${data.name}-${tier}` : data.name;
		} else {
			cls = data.system.isSingleUse
				? "litm-power_tag litm--single-use"
				: "litm-power_tag";
			label = data.system.isSingleUse ? `${data.name} ✱` : data.name;
		}
		out += `<span class="${cls}" data-text="${foundry.utils.escapeHTML(data.name)}" draggable="true">${foundry.utils.escapeHTML(label)}</span>`;

		lastIndex = end;
	}
	if (lastIndex < text.length)
		out += foundry.utils.escapeHTML(text.slice(lastIndex));
	return out;
}
