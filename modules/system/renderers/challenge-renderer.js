import { enrichHTML, levelIcon, localize as t } from "../../utils.js";
import { makeActorCard, sectionHeader } from "./renderer-utils.js";
import { renderVignette } from "./vignette-renderer.js";

/**
 * Render a rating star via the shared `rating-star.html` Handlebars partial
 * (the same one the play-header and play-description templates use). Keeps
 * the SVG path in a single source-of-truth file instead of duplicating it
 * here in JS.
 *
 * @param {boolean} filled
 * @returns {Promise<SVGElement>}
 */
async function ratingStar(filled) {
	const html = await foundry.applications.handlebars.renderTemplate(
		"systems/litmv2/templates/partials/rating-star.html",
		{ cssClass: filled ? "filled" : "empty" },
	);
	const template = document.createElement("template");
	template.innerHTML = html.trim();
	return template.content.firstElementChild;
}

/**
 * Renders a Challenge actor as a read-only embed card.
 * Clicking the card opens the challenge sheet.
 * @param {Actor} actor - A challenge actor document
 * @returns {HTMLElement}
 */
export async function renderChallenge(actor) {
	const sys = actor.system;

	const { container, headerText } = makeActorCard(
		actor,
		"litm-render--challenge",
	);

	// Stars + category on a line below the name
	const meta = document.createElement("div");
	meta.classList.add("litm-render--challenge__meta");

	const displayRating = sys.derivedRating ?? sys.rating;
	if (displayRating) {
		const stars = document.createElement("span");
		stars.classList.add("litm-render--challenge__stars");
		for (let i = 1; i <= 5; i++) {
			stars.appendChild(await ratingStar(i <= displayRating));
		}
		meta.appendChild(stars);
	}

	const displayCategories = sys.derivedCategories?.length
		? sys.derivedCategories.join(", ")
		: sys.category;
	if (displayCategories) {
		const cat = document.createElement("span");
		cat.classList.add("litm-render--challenge__category");
		cat.textContent = displayCategories;
		meta.appendChild(cat);
	}

	if (meta.children.length) headerText.appendChild(meta);

	// ── Description ──
	if (sys.description) {
		const desc = document.createElement("div");
		desc.classList.add("litm-render--challenge__description");
		desc.innerHTML = await enrichHTML(sys.description, actor);
		container.appendChild(desc);
	}

	// ── Two-column grid: (Limits + Tags/Might) | Vignettes ──
	const limits =
		(sys.derivedLimits ?? sys.limits)?.filter((l) => l.label) ?? [];
	const vignettes = actor.items.filter((i) => i.type === "vignette");
	const might =
		(sys.derivedMight ?? sys.might)?.filter((m) => m.description) ?? [];
	const displayTags = sys.derivedTags || sys.tags;
	const hasLeft =
		limits.length || displayTags || might.length || sys.specialFeatures;
	const addonThreats = sys.addonThreats || [];
	const hasRight = vignettes.length > 0 || addonThreats.length > 0;

	if (hasLeft || hasRight) {
		const grid = document.createElement("div");
		grid.classList.add("grid-2col");

		// Left column: Limits → Tags & Might
		if (hasLeft) {
			const leftCol = document.createElement("div");

			// Limits
			if (limits.length) {
				leftCol.appendChild(sectionHeader(t("LITM.Terms.limits")));
				for (const limit of limits) {
					const item = document.createElement("div");
					item.classList.add("litm-render--challenge__limit-item");

					const badge = document.createElement("span");
					badge.classList.add("litm-limit");
					badge.dataset.text = limit.label;
					badge.textContent = limit.label;

					const isImpossible = limit.max === 0;
					const icon = document.createElement("img");
					icon.src = "systems/litmv2/assets/media/icons/limit.svg";
					icon.classList.add("litm-render--challenge__limit-icon");
					badge.appendChild(icon);

					const max = document.createElement("span");
					max.classList.add("litm-render--challenge__limit-max");
					max.textContent = isImpossible ? "~" : limit.max;
					badge.appendChild(max);

					item.appendChild(badge);
					leftCol.appendChild(item);

					if (limit.outcome) {
						const outcome = document.createElement("div");
						outcome.classList.add("litm-render--challenge__outcome");
						outcome.textContent = limit.outcome;
						leftCol.appendChild(outcome);
					}
				}
			}

			// Tags & Statuses + Might (combined)
			if (displayTags || might.length) {
				leftCol.appendChild(sectionHeader(t("LITM.Terms.tags_statuses")));

				if (displayTags) {
					const tags = document.createElement("div");
					tags.classList.add("litm-render--challenge__tags");
					tags.textContent = displayTags;
					leftCol.appendChild(tags);
				}

				for (const entry of might) {
					const row = document.createElement("div");
					row.classList.add("litm-render--challenge__might-entry");

					const icon = document.createElement("img");
					icon.classList.add("litm-render--challenge__might-icon");
					icon.src = levelIcon(entry.level);
					row.appendChild(icon);

					const desc = document.createElement("span");
					desc.textContent = entry.description;
					row.appendChild(desc);

					leftCol.appendChild(row);
				}
			}

			// Special Features
			if (sys.specialFeatures) {
				leftCol.appendChild(sectionHeader(t("LITM.Terms.special_features")));
				const sf = document.createElement("div");
				sf.classList.add(
					"litm-render--challenge__special-features",
					"enriched-content",
				);
				sf.innerHTML = await enrichHTML(sys.specialFeatures, actor);
				leftCol.appendChild(sf);
			}

			grid.appendChild(leftCol);
		}

		// Right column: Threats & Consequences
		if (hasRight) {
			const rightCol = document.createElement("div");
			rightCol.appendChild(sectionHeader(t("LITM.Terms.threats_consequences")));
			for (const v of vignettes) {
				rightCol.appendChild(await renderVignette(v));
			}
			for (const threat of addonThreats) {
				const mockItem = {
					name: threat.name,
					system: {
						threat: threat.threat,
						consequences: threat.consequences,
						isConsequenceOnly: threat.isConsequenceOnly,
					},
				};
				rightCol.appendChild(await renderVignette(mockItem, actor));
			}
			grid.appendChild(rightCol);
		}

		container.appendChild(grid);
	}

	return container;
}
