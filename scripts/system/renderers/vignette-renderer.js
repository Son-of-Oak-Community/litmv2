/**
 * Renders a Vignette item as an embed card, matching the challenge sheet style.
 * Tags/statuses in threat and consequence text are left as raw text nodes
 * so the tag enricher (which runs after @render) processes them.
 * @param {Item} item - A vignette item document
 * @returns {HTMLElement}
 */
export function renderVignette(item) {
	const { threat, consequences, isConsequenceOnly } = item.system;

	const container = document.createElement("fieldset");
	container.classList.add("litm", "vignette-card", "litm-render");

	// Banner title
	const legend = document.createElement("legend");
	legend.classList.add("litm-banner", "vignette-card-label");
	legend.textContent = item.name;
	container.appendChild(legend);

	// Threat description
	if (!isConsequenceOnly && threat) {
		const div = document.createElement("div");
		div.classList.add("threat-text");
		div.textContent = threat;
		container.appendChild(div);
	}

	// Consequences
	if (consequences.length) {
		const ul = document.createElement("ul");
		ul.classList.add("consequences-list");
		for (const c of consequences) {
			const li = document.createElement("li");
			li.classList.add("consequence-item");
			li.textContent = c;
			ul.appendChild(li);
		}
		container.appendChild(ul);
	}

	return container;
}
