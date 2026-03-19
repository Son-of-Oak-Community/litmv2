import { localize as t } from "../../utils.js";

/**
 * Builds a tag tooltip HTML string from a theme's power/weakness tags,
 * matching the hero creation overlay pattern.
 * @param {object} system - Theme system data
 * @returns {string}
 */
function buildTagTooltip(system) {
	const esc = foundry.utils.escapeHTML;
	const power = (system?.powerTags || [])
		.map((t) => t?.name || "")
		.filter(Boolean);
	const weakness = (system?.weaknessTags || [])
		.map((t) => t?.name || "")
		.filter(Boolean);
	if (!power.length && !weakness.length) return "";

	const sections = [];
	if (power.length) {
		sections.push(
			`<div class="tag-tooltip-group"><label>${t("LITM.Tags.power_tags")}</label>${power
				.map(
					(n) =>
						`<span class="litm-powerTag" data-text="${esc(n)}">${esc(n)}</span>`,
				)
				.join(" ")}</div>`,
		);
	}
	if (weakness.length) {
		sections.push(
			`<div class="tag-tooltip-group"><label>${t("LITM.Tags.weakness_tags")}</label>${weakness
				.map(
					(n) =>
						`<span class="litm-weaknessTag" data-text="${esc(n)}">${esc(n)}</span>`,
				)
				.join(" ")}</div>`,
		);
	}
	return sections.join("");
}

/**
 * Renders a theme kit reference as a list item with tooltip.
 * @param {string} uuid - Theme item UUID
 * @returns {Promise<HTMLElement>}
 */
async function renderKitEntry(uuid) {
	const item = await fromUuid(uuid);
	const li = document.createElement("li");
	if (!item) {
		li.textContent = uuid;
		return li;
	}

	const tooltip = buildTagTooltip(item.system);
	if (tooltip) li.dataset.tooltip = tooltip;

	if (item.img) {
		const img = document.createElement("img");
		img.src = item.img;
		img.classList.add("noflex", "icon-sm");
		li.appendChild(img);
	}

	const name = document.createElement("strong");
	name.textContent = item.name;
	li.appendChild(name);

	// Themebook label in parentheses
	if (item.system?.themebook) {
		li.appendChild(document.createTextNode(` (${item.system.themebook})`));
	}

	return li;
}

/**
 * Renders a Trope item as an embed card.
 * Resolves theme kit UUIDs to show names with tag tooltips.
 * Backpack choices rendered as litm-tag spans.
 * @param {Item} item - A trope item document
 * @returns {Promise<HTMLElement>}
 */
export async function renderTrope(item) {
	const sys = item.system;

	const container = document.createElement("div");
	container.classList.add("litm", "litm-render", "litm-render--trope");

	// Title
	const title = document.createElement("h3");
	title.classList.add("litm-render__title");
	title.textContent = item.name;
	container.appendChild(title);

	// Category
	if (sys.category) {
		const cat = document.createElement("div");
		cat.classList.add("litm-render--trope__category");
		cat.textContent = sys.category;
		container.appendChild(cat);
	}

	// Description
	if (sys.description) {
		const desc = document.createElement("div");
		desc.classList.add("litm-render--trope__description");
		desc.innerHTML = sys.description;
		container.appendChild(desc);
	}

	// Theme Kits
	const fixed = sys.themeKits?.fixed?.filter((k) => k) ?? [];
	const optional = sys.themeKits?.optional?.filter((k) => k) ?? [];

	if (fixed.length || optional.length) {
		const section = document.createElement("div");
		section.classList.add("litm-render--trope__kits");

		// Fixed kits
		if (fixed.length) {
			const header = document.createElement("div");
			header.classList.add("litm-render__section-header");
			header.textContent = t("LITM.Ui.theme_kits_fixed");
			section.appendChild(header);

			const ul = document.createElement("ul");
			ul.classList.add("themekit-list");
			for (const uuid of fixed) {
				ul.appendChild(await renderKitEntry(uuid));
			}
			section.appendChild(ul);
		}

		// Optional kits
		if (optional.length) {
			const header = document.createElement("div");
			header.classList.add("litm-render__section-header");
			header.textContent = t("LITM.Ui.theme_kits_optional");
			section.appendChild(header);

			const ul = document.createElement("ul");
			ul.classList.add("themekit-list");
			for (const uuid of optional) {
				const li = await renderKitEntry(uuid);
				li.classList.add("optional");
				ul.appendChild(li);
			}
			section.appendChild(ul);
		}

		container.appendChild(section);
	}

	// Backpack Choices as litm-tag spans
	const backpack = sys.backpackChoices?.filter((b) => b) ?? [];
	if (backpack.length) {
		const bp = document.createElement("div");
		bp.classList.add("litm-render--trope__backpack");
		const label = document.createElement("strong");
		label.textContent = `${t("LITM.Ui.backpack_choices")}: `;
		bp.appendChild(label);

		backpack.forEach((tag, i) => {
			const span = document.createElement("span");
			span.classList.add("litm-tag");
			span.dataset.text = tag;
			span.draggable = true;
			span.textContent = tag;
			bp.appendChild(span);
			if (i < backpack.length - 1) {
				bp.appendChild(document.createTextNode(", "));
			}
		});

		container.appendChild(bp);
	}

	return container;
}
