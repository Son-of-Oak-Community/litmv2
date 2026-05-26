import { enrichHTML, localize as t } from "../../utils.js";
import { makeActorCard } from "./renderer-utils.js";
import { renderVignette, vignetteCard } from "./vignette-renderer.js";

/**
 * Renders a Journey actor as a read-only embed card.
 * Clicking the card opens the journey sheet.
 * @param {Actor} actor - A journey actor document
 * @returns {HTMLElement}
 */
export async function renderJourney(actor) {
	const sys = actor.system;

	const { container, headerText } = makeActorCard(
		actor,
		"litm-render--journey",
	);

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
		container.appendChild(
			await vignetteCard({
				label: t("LITM.Terms.general_consequences"),
				consequences: generalConsequence.system.consequences,
				isConsequenceOnly: true,
				relativeTo: generalConsequence,
			}),
		);
	}

	// ── Vignettes ──
	const vignettes = actor.items.filter(
		(i) => i.type === "vignette" && i.id !== sys.generalConsequences,
	);
	if (vignettes.length) {
		const grid = document.createElement("div");
		grid.classList.add("grid-2col");
		for (const v of vignettes) {
			grid.appendChild(await renderVignette(v));
		}
		container.appendChild(grid);
	}

	return container;
}
