/**
 * Creates a tag span matching the hero play sheet pattern.
 * @param {string} name - Tag name
 * @param {string} type - Tag CSS class (litm-powerTag, litm-weaknessTag, etc.)
 * @returns {HTMLElement}
 */
function tagSpan(name, type) {
	const span = document.createElement("span");
	span.classList.add(type);
	span.dataset.text = name;
	span.draggable = true;
	span.textContent = name;
	return span;
}

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

	// Title as a themeTag
	const header = document.createElement("div");
	header.classList.add("theme-card-header");
	header.appendChild(tagSpan(item.name, "litm-themeTag"));
	container.appendChild(header);

	// Power tags
	const powerTags = sys.powerTags?.filter((t) => t.name) ?? [];
	if (powerTags.length) {
		const tags = document.createElement("div");
		tags.classList.add("theme-card-tags");
		for (const pt of powerTags) {
			tags.appendChild(tagSpan(pt.name, "litm-powerTag"));
		}
		container.appendChild(tags);
	}

	// Weakness tags
	const weakTags = sys.weaknessTags?.filter((t) => t.name) ?? [];
	if (weakTags.length) {
		const tags = document.createElement("div");
		tags.classList.add("theme-card-tags");
		for (const wt of weakTags) {
			tags.appendChild(tagSpan(wt.name, "litm-weaknessTag"));
		}
		container.appendChild(tags);
	}

	// Quest
	if (sys.quest?.description) {
		const quest = document.createElement("blockquote");
		quest.classList.add("theme-card__quest");
		quest.textContent = sys.quest.description;
		container.appendChild(quest);
	}

	return container;
}
