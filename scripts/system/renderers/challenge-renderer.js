import { localize as t } from "../../utils.js";
import { renderVignette } from "./vignette-renderer.js";

const RATING_STAR_PATH =
	"M61.97 0c.32.02.58.08.87.16.46.09.93.08 1.4.09 2.54.08 4.83.66 6.7 2.48a43 43 0 0 1 2.9 4.24c.77 1.4 1.57 2.86 1.83 4.45.05.3.1.44.33.64.26.1.48.15.76.19 3.3.47 6.32 1.46 8.79 3.79 1.25 1.18 2.21 2.66 3.1 4.12.84 1.36 1.17 2.75 1.26 4.33l.04.67c.02.25.06.48.11.72.01.24.02.48.02.72 0 .51-.04.77-.3 1.08-.19.14-.37.27-.57.39l-.3.19c-.13.08-.27.15-.4.23l-.29.17c-.9.5-1.82.84-2.8 1.16-1.32.43-2.48 1-3.61 1.81l-.23.16c-.94.67-1.84 1.37-2.69 2.16-.19.17-.38.34-.58.51-.39.34-.76.69-1.12 1.05l-.2.2c-.14.14-.28.28-.42.42-.14.14-.29.28-.43.42-1.13 1.1-2.12 2.17-2.77 3.63l-.11.24c-.28.61-.55 1.23-.77 1.87l-.09.27c-.12.44-.12.89-.13 1.33v.28c0 .2 0 .4 0 .6 0 .2 0 .4-.01.6-.04 1.32.05 2.29.78 3.41.06.1.13.2.19.31.62.98 1.35 1.85 2.26 2.58l.15.14c.55.49 1.1.5 1.82.52h.65l.24.01c.25.02.49.06.73.11 2.64.19 4.62-.61 6.61-2.31l.27-.25c.64-.57 1.3-1.05 2.01-1.52.74-.49 1.34-.95 1.88-1.66l.24-.31c.13-.16.26-.32.38-.48.33-.43.69-.83 1.06-1.22.28-.31.55-.64.81-.96.16-.19.32-.38.49-.57 2.54-2.85 2.54-2.85 4.02-6.31.13-.49.36-.88.69-1.26.73-.42 1.83-.28 2.63-.16.69.19 1.29.55 1.9.91.18.1.35.19.53.29.52.29 1.04.58 1.56.88l.44.25c.13.08.27.15.4.23l.18.1c.89.52 1.63 1.11 2.34 1.85.47.48.95.96 1.46 1.4.63.55 1.17 1.23 1.61 1.94l.18.29c.57.98.78 2.04 1.03 3.13.17.74.39 1.45.63 2.17.1.33.2.66.3.99l.17.56.11.38c.05.19.11.37.17.56l.1.33c.17.35.31.41.68.54.19.04.38.07.58.1 3.56.62 8.11 3.39 10.28 6.34 1.37 2.01 1.84 4.61 1.5 6.99-.36 1.34-1.24 2.57-2.12 3.62l-.14.16c-1.82 2.18-4.44 4.48-7.38 4.89-.39.03-.78.04-1.17.05h-.24l-.22.01c-.21.01-.21.01-.46.11 0 .09.01.17.01.26.03.96-.11 1.8-.38 2.72l-.07.23c-.81 2.85-1.72 5.89-3.83 8.07l-.3.36c-1.79 2.02-4.12 3.58-6.76 4.24l-.33.09c-1.36.37-3.2.82-4.56.27-.93-.62-1.16-1.69-1.4-2.71-.18-.76-.37-1.45-.91-2.05-.27-.32-.41-.67-.55-1.06l-.08-.22c-.13-.33-.25-.67-.36-1c-.29-.96-.29-.96-.98-1.64l-.07-.03c-.51-.26-.7-.65-.96-1.15-.34-.66-.58-1.11-1.23-1.5-.4-.27-.73-.62-1.06-.97-.43-.44-.87-.87-1.35-1.27l-.34-.31c-.28-.27-.47-.37-.87-.4h-.67c-.29-.02-.29-.02-.5-.16-.17-.22-.28-.43-.4-.68-.25-.32-.59-.42-.99-.47l-.12-.01c-.83-.08-1.59-.32-2.38-.59-1.97-.61-5.02-.11-6.86.8-.86.52-2.14 1.34-2.48 2.32l-.06.3-.06.3-.05.29-.05.24c-.17 1.3-.08 2.64.23 3.91l.09.37c.13.55.28 1.1.47 1.64.17.47.24.94.3 1.43.08.42.28.7.6.98.31.3.55.63.8.98.68.98 1.45 1.87 2.27 2.75l.13.14c1.23 1.3 2.66 2.31 4.22 3.2l.2.12c1.94 1.09 4.03 1.82 6.12 2.58 1.77.64 1.77.64 2.38 1.19l.25.21c.51.62.63 1.26.65 2.04v.18c.06 1.12-.12 2.09-.47 3.16l-.06.19c-.63 1.92-1.71 3.74-3.11 5.21-.2.2-.2.2-.4.46-.24.29-.51.5-.82.72l-.17.12c-.77.52-1.58.92-2.41 1.31l-.27.13c-.18.08-.36.17-.54.25-.44.21-.83.43-1.23.71-.56.36-1.1.37-1.75.36h-1c-.07 0-.14 0-.21 0-.87.01-1.73.13-2.6.25-.23.03-.46.06-.7.08l-.21.02c-.18.02-.35.03-.53.05-.27.04-.27.04-.41.22-.15.25-.16.41-.16.7v.29c0 .1 0 .2 0 .3-.03 3.26-2.06 6.12-4.3 8.33C70.1 126.7 67.24 128.03 64.28 128c-.59-.02-.99-.15-1.5-.46-.31-.15-.53-.15-.87-.12-.12.06-.25.12-.36.18-.48.06-.93.07-1.38-.13-.16-.14-.31-.28-.47-.43-.5-.45-.89-.77-1.55-.94l-.23-.06-.21-.05c-2.02-.84-3.44-3.31-4.4-5.16l-.1-.17c-.53-1-.92-2.05-1.3-3.12l-.07-.18c-.25-.69-.47-1.34-.52-2.08-.16-.3-.22-.34-.54-.45-.14-.01-.29-.02-.44-.03-4.52-.28-9.06-1.5-12.27-4.86-.87-1-1.51-2.12-2.06-3.32l-.08-.18c-.53-1.13-.83-2.31-1.1-3.52l-.05-.22c-.17-.75-.25-1.47-.26-2.24v-.22c0-.52.11-.81.47-1.2.21-.19.43-.37.65-.55l.17-.14c.67-.51 1.34-.78 2.15-1.01.85-.25 1.45-.61 2.1-1.21.39-.33.83-.58 1.28-.84.21-.13.42-.25.63-.38l.16-.1c.66-.4 1.31-.82 1.95-1.25l.17-.11C47.05 91.58 47.05 91.58 48.95 89.03c.22-.45.5-.78.85-1.14 1.76-1.81 2.64-4.34 3.19-6.77l.04-.19c.17-.82.06-1.52-.11-2.32l-.06-.28c-.23-1.12-.6-2-1.58-2.64-1.62-1-3.15-1.06-5-0.85l-.33.04c-2.73.23-2.73.23-5.15 1.38-.1.13-.2.26-.29.39-.33.44-.71.73-1.16 1.04-.15.11-.3.22-.46.33l-.08.05c-.58.42-1.11.88-1.66 1.33l-.05.04c-.63.54-1.16 1.12-1.67 1.77l-.12.15c-.37.48-.73.96-1.08 1.46-.32.47-.66.91-1.02 1.35-1.1 1.33-1.86 2.71-2.54 4.29-1.53 3.53-1.53 3.53-3.12 4.18-2 .24-3.89-.73-5.62-1.63l-.07-.03c-1.86-.97-4.25-2.28-5.04-4.32-.25-.59-.45-.93-.99-1.28-1.64-1.3-2.46-4.87-2.77-6.86-.12-.75-.28-1.35-.87-1.87-.34-.24-.59-.27-1-.28-2.79-.17-6.21-2.83-8.15-4.68l-.25-.23c-.87-.94-1.32-2.05-1.72-3.25l-.08-.23c-.36-1.1-.53-2.16-.51-3.32v-.36c.01-.83.05-1.63.21-2.45l.05-.27c.11-.46.22-.66.62-.93.29-.3.4-.69.55-1.07.3-.74.62-1.23 1.2-1.78l.19-.18c2.28-2.22 5.11-3.52 8.08-4.6l.1-.04c.36-.1.72-.14 1.09-.18.3-.08.42-.19.61-.43.44-.87.53-1.97.67-2.95.15-1.02.32-1.98.69-2.94l.08-.21c.84-2.12 1.95-4.2 3.45-5.92l.14-.16c1.77-1.9 5.07-3.39 7.65-3.55h.87c.1 0 .2 0 .31-.01.56 0 .94 0 1.37.4.26.3.43.57.58.93l.12.28c.04.1.09.2.13.31 2.63 6.02 5.71 11.15 12.02 13.63l.18.07c.61.24 1.21.48 1.81.75 1.24.55 2.35.91 3.73.83h.33c.68-.03 1.3-.13 1.94-.35l.17-.06c1.67-.57 3.06-1.42 3.91-3.01l.14-.27c.72-1.43.97-2.91.97-4.5v-.2c0-.98-.03-1.93-.3-2.88l-.07-.26c-.2-.71-.49-1.33-.85-1.98l-.16-.28c-.15-.27-.31-.55-.46-.83l-.07-.13c-.55-.96-1.1-1.66-2.08-2.22-.49-.3-.81-.66-1.16-1.1-.36-.46-.65-.74-1.21-.91-.85-.29-1.58-.87-2.32-1.38-1.98-1.35-1.98-1.35-4.13-2.4l-.07-.03c-.21-.08-.42-.17-.62-.25l-.27-.11c-.63-.22-1.24-.34-1.88-.47-2.84-.57-2.84-.57-3.46-1.49-.31-1.62-.08-2.96.64-4.42l.08-.16c.54-1.14 1.13-2.12 2.01-3.03.19-.2.37-.41.56-.62.13-.14.26-.28.39-.42l.15-.16C40.93 17.42 45.57 14.36 48.84 14.14c.45-.03.75-.14 1.1-.41l.27-.2c.69-.52.69-.52 1.06-1.27.03-.27.04-.53.05-.8v-.2l.01-.2c.03-.63.26-1.05.6-1.57.38-.63.5-1.16.59-1.88.1-.62.53-.94.96-1.36.35-.37.58-.76.74-1.25C54.93 3.03 58.3 1.34 60.09.48 60.73.18 61.26.01 61.97 0Z";

/**
 * Creates a section divider with a centered label and decorative lines.
 * @param {string} label
 * @returns {HTMLElement}
 */
function sectionHeader(label) {
	const el = document.createElement("div");
	el.classList.add("litm-render__section-header");
	el.textContent = label;
	return el;
}

/**
 * Creates a rating star SVG element.
 * @param {boolean} filled
 * @returns {SVGElement}
 */
function ratingStar(filled) {
	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.classList.add("rating-star", filled ? "filled" : "empty");
	svg.setAttribute("width", "16");
	svg.setAttribute("height", "16");
	svg.setAttribute("viewBox", "0 0 128 128");
	svg.setAttribute("fill", "none");
	const path = document.createElementNS(ns, "path");
	path.setAttribute("d", RATING_STAR_PATH);
	path.setAttribute("fill", "var(--color-text-primary)");
	svg.appendChild(path);
	return svg;
}

/**
 * Renders a Challenge actor as a read-only embed card.
 * Clicking the card opens the challenge sheet.
 * @param {Actor} actor - A challenge actor document
 * @returns {HTMLElement}
 */
export function renderChallenge(actor) {
	const sys = actor.system;
	const hasCustomImage = actor.img !== "icons/svg/mystery-man.svg";

	const container = document.createElement("div");
	container.classList.add("litm", "litm-render", "litm-render--challenge");
	container.dataset.uuid = actor.uuid;
	container.addEventListener("click", () => actor.sheet.render(true));

	// ── Header: portrait + name + stars + category ──
	const header = document.createElement("div");
	header.classList.add("litm-render--challenge__header");

	if (hasCustomImage) {
		const img = document.createElement("img");
		img.classList.add("litm-render--challenge__portrait");
		img.src = actor.img;
		header.appendChild(img);
	}

	const headerText = document.createElement("div");
	headerText.classList.add("litm-render--challenge__header-text");

	const title = document.createElement("h3");
	title.classList.add("litm-render__title");
	title.textContent = actor.name;
	headerText.appendChild(title);

	// Stars + category on a line below the name
	const meta = document.createElement("div");
	meta.classList.add("litm-render--challenge__meta");

	if (sys.rating) {
		const stars = document.createElement("span");
		stars.classList.add("litm-render--challenge__stars");
		for (let i = 1; i <= 5; i++) {
			stars.appendChild(ratingStar(i <= sys.rating));
		}
		meta.appendChild(stars);
	}

	if (sys.category) {
		const cat = document.createElement("span");
		cat.classList.add("litm-render--challenge__category");
		cat.textContent = sys.category;
		meta.appendChild(cat);
	}

	if (meta.children.length) headerText.appendChild(meta);

	header.appendChild(headerText);
	container.appendChild(header);

	// ── Description ──
	if (sys.description) {
		const desc = document.createElement("div");
		desc.classList.add("litm-render--challenge__description");
		desc.innerHTML = sys.description;
		container.appendChild(desc);
	}

	// ── Two-column grid: (Limits + Tags/Might) | Vignettes ──
	const limits = sys.limits?.filter((l) => l.label) ?? [];
	const vignettes = actor.items.filter((i) => i.type === "vignette");
	const might = sys.might?.filter((m) => m.description) ?? [];
	const hasLeft =
		limits.length || sys.tags || might.length || sys.specialFeatures;
	const hasRight = vignettes.length > 0;

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

					const isImpossible = limit.max === "~";
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
			if (sys.tags || might.length) {
				leftCol.appendChild(sectionHeader(t("LITM.Terms.tags_statuses")));

				if (sys.tags) {
					const tags = document.createElement("div");
					tags.classList.add("litm-render--challenge__tags");
					tags.textContent = sys.tags;
					leftCol.appendChild(tags);
				}

				for (const entry of might) {
					const row = document.createElement("div");
					row.classList.add("litm-render--challenge__might-entry");

					const icon = document.createElement("img");
					icon.classList.add("litm-render--challenge__might-icon");
					icon.src = `systems/litmv2/assets/media/icons/${entry.level}.svg`;
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
				sf.innerHTML = sys.specialFeatures;
				leftCol.appendChild(sf);
			}

			grid.appendChild(leftCol);
		}

		// Right column: Threats & Consequences
		if (hasRight) {
			const rightCol = document.createElement("div");
			rightCol.appendChild(sectionHeader(t("LITM.Terms.threats_consequences")));
			for (const v of vignettes) {
				rightCol.appendChild(renderVignette(v));
			}
			grid.appendChild(rightCol);
		}

		container.appendChild(grid);
	}

	return container;
}
