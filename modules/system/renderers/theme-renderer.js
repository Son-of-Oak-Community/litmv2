import { levelIcon } from "../../utils.js";
import { tagSpan } from "./renderer-utils.js";

/**
 * Renders a Theme item (theme kit) as an embed card,
 * matching the hero play sheet's theme-card pattern.
 * @param {Item} item - A theme item document
 * @returns {HTMLElement}
 */
export function renderTheme(item) {
	const sys = item.system;

	const container = document.createElement("fieldset");
	container.classList.add(
		"litm",
		"litm-render",
		"theme-card",
		"litm-render--theme",
	);

	// Themebook banner
	if (sys.themebook) {
		const legend = document.createElement("legend");
		legend.classList.add("litm-banner", "theme-card__book");
		legend.textContent = sys.themebook;
		container.appendChild(legend);
	}

	// Header as on the hero sheet: might icon, then the title tag
	const header = document.createElement("div");
	header.classList.add("theme-card-header");
	const row = document.createElement("div");
	row.classList.add("flexrow", "noflex", "gap-sm");
	const levelLabel = game.i18n.localize(`LITM.Terms.${sys.level}`);
	const icon = document.createElement("img");
	icon.classList.add("noflex", "icon-md");
	icon.src = item.img || levelIcon(sys.level);
	icon.alt = levelLabel;
	icon.dataset.tooltip = levelLabel;
	row.appendChild(icon);
	const title = tagSpan(sys.themeTag?.name || item.name, "litm-power_tag");
	title.classList.add("noflex", "litm-title_tag");
	row.appendChild(title);
	header.appendChild(row);
	container.appendChild(header);

	// Power and weakness tags share one wrapping row, as on the hero sheet
	const tags = document.createElement("div");
	tags.classList.add("theme-card-tags");
	for (const pt of sys.powerTags?.filter((t) => t.name) ?? []) {
		tags.appendChild(tagSpan(pt.name, "litm-power_tag"));
	}
	for (const wt of sys.weaknessTags?.filter((t) => t.name) ?? []) {
		tags.appendChild(tagSpan(wt.name, "litm-weakness_tag"));
	}
	if (tags.children.length) container.appendChild(tags);

	// Quest
	if (sys.quest?.description) {
		const quest = document.createElement("blockquote");
		quest.classList.add("theme-card__quest");
		quest.textContent = sys.quest.description;
		container.appendChild(quest);
	}

	return container;
}
