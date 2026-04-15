import { enrichHTML, localize as t } from "../../utils.js";
import { renderVignette } from "./vignette-renderer.js";
import { makeActorCard } from "./renderer-utils.js";

/**
 * Renders a Journey actor as a read-only embed card.
 * Clicking the card opens the journey sheet.
 * @param {Actor} actor - A journey actor document
 * @returns {HTMLElement}
 */
export async function renderJourney(actor) {
	const sys = actor.system;

	const { container, headerText } = makeActorCard(actor, "litm-render--journey");

	if (sys.category) {
		const cat = document.createElement("span");
		cat.classList.add("litm-render--journey__category");
		cat.textContent = sys.category;
		headerText.appendChild(cat);
	}

	// ── Description ──
	if (sys.description) {
		const desc = document.createElement("div");
		desc.classList.add("litm-render--journey__description");
		desc.innerHTML = await enrichHTML(sys.description, actor);
		container.appendChild(desc);
	}

	// ── Tags & Statuses ──
	if (sys.tags) {
		const tagsSection = document.createElement("div");
		tagsSection.classList.add("litm-render--journey__tags");
		// Leave as text so the tag enricher processes it
		tagsSection.textContent = sys.tags;
		container.appendChild(tagsSection);
	}

	// ── General Consequences ──
	const generalConsequence = sys.generalConsequences
		? actor.items.get(sys.generalConsequences)
		: null;
	if (generalConsequence?.system?.consequences?.length) {
		const gc = document.createElement("fieldset");
		gc.classList.add("litm", "vignette-card", "litm-render");
		const legend = document.createElement("legend");
		legend.classList.add("litm-banner", "vignette-card-label");
		legend.textContent = t("LITM.Terms.general_consequences");
		gc.appendChild(legend);

		const ul = document.createElement("ul");
		ul.classList.add("consequences-list");
		for (const c of generalConsequence.system.consequences) {
			const li = document.createElement("li");
			li.classList.add("consequence-item");
			li.textContent = c;
			ul.appendChild(li);
		}
		gc.appendChild(ul);
		container.appendChild(gc);
	}

	// ── Vignettes ──
	const vignettes = actor.items.filter(
		(i) => i.type === "vignette" && i.id !== sys.generalConsequences,
	);
	if (vignettes.length) {
		const grid = document.createElement("div");
		grid.classList.add("grid-2col");
		for (const v of vignettes) {
			grid.appendChild(renderVignette(v));
		}
		container.appendChild(grid);
	}

	return container;
}
