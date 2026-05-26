import { enrichHTML } from "../../utils.js";

/**
 * Build the vignette-card fieldset shape. Used by both `renderVignette` and
 * the journey renderer's "general consequences" block, which is structurally
 * the same fieldset with a localized banner label and consequence-only data.
 *
 * Threat and consequence strings may contain HTML markup (from paste or
 * imported pack content), so they're run through `enrichHTML` — that handles
 * both rich-text passthrough and litm tag/status enrichment in one pass.
 *
 * @param {object} options
 * @param {string} options.label                   Banner label text
 * @param {string} [options.threat]                Threat description (may be HTML)
 * @param {string[]} [options.consequences=[]]    Consequence strings (may be HTML)
 * @param {boolean} [options.isConsequenceOnly=false]
 * @param {Document} [options.relativeTo]          Document context for enrichment
 * @returns {Promise<HTMLElement>}
 */
export async function vignetteCard({
	label,
	threat,
	consequences = [],
	isConsequenceOnly = false,
	relativeTo,
}) {
	const container = document.createElement("fieldset");
	container.classList.add("litm", "vignette-card", "litm-render");

	const legend = document.createElement("legend");
	legend.classList.add("litm-banner", "vignette-card-label");
	legend.textContent = label;
	container.appendChild(legend);

	if (!isConsequenceOnly && threat) {
		const div = document.createElement("div");
		div.classList.add("threat-text");
		div.innerHTML = await enrichHTML(threat, relativeTo);
		container.appendChild(div);
	}

	if (consequences.length) {
		const ul = document.createElement("ul");
		ul.classList.add("consequences-list");
		for (const c of consequences) {
			const li = document.createElement("li");
			li.classList.add("consequence-item");
			li.innerHTML = await enrichHTML(c, relativeTo);
			ul.appendChild(li);
		}
		container.appendChild(ul);
	}

	return container;
}

/**
 * Renders a Vignette item as an embed card, matching the challenge sheet style.
 * @param {Item|object} item       A vignette item document, or a mock shaped
 *                                  like one (e.g. addonThreats on a challenge)
 * @param {Document} [relativeTo]  Document context for enrichment; defaults to
 *                                  `item` when it's a real document
 * @returns {Promise<HTMLElement>}
 */
export function renderVignette(item, relativeTo = item) {
	const { threat, consequences, isConsequenceOnly } = item.system;
	return vignetteCard({
		label: item.name,
		threat,
		consequences,
		isConsequenceOnly,
		relativeTo,
	});
}
