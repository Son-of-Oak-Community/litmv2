import { enrichHTML, localize as t } from "../../utils.js";
import { tagSpan, makeActorCard } from "./renderer-utils.js";

/**
 * Renders a Hero actor as a read-only embed card.
 * Clicking the card opens the hero sheet.
 * @param {Actor} actor - A hero actor document
 * @returns {HTMLElement}
 */
export async function renderHero(actor) {
	const sys = actor.system;

	const { container, headerText } = makeActorCard(actor, "litm-render--hero");

	// Promise track
	if (sys.promise > 0) {
		const promise = document.createElement("div");
		promise.classList.add("litm-render--hero__promise");

		const label = document.createElement("span");
		label.classList.add("litm-render--hero__promise-label");
		label.textContent = t("LITM.Hero.promise");
		promise.appendChild(label);

		const pips = document.createElement("span");
		pips.classList.add("litm-render--hero__promise-pips");
		for (let i = 1; i <= 5; i++) {
			const pip = document.createElement("span");
			pip.classList.add(
				"litm-render--hero__pip",
				i <= sys.promise ? "filled" : "empty",
			);
			pips.appendChild(pip);
		}
		promise.appendChild(pips);

		headerText.appendChild(promise);
	}

	// ── Description ──
	if (sys.description) {
		const desc = document.createElement("div");
		desc.classList.add("litm-render--hero__description");
		desc.innerHTML = await enrichHTML(sys.description, actor);
		container.appendChild(desc);
	}

	// ── Themes ──
	const themes = actor.items.filter(
		(i) => i.type === "theme" || i.type === "story_theme",
	);
	if (themes.length) {
		const themesContainer = document.createElement("div");
		themesContainer.classList.add("litm-render--hero__themes");

		for (const theme of themes) {
			const themeEl = document.createElement("div");
			themeEl.classList.add("litm-render--hero__theme");

			// Theme tag (name)
			themeEl.appendChild(tagSpan(theme.name, "litm-theme_tag"));

			// Power tags
			const powerTags = theme.system.powerTags?.filter((tag) => tag.name) ?? [];
			if (powerTags.length) {
				const tagsRow = document.createElement("div");
				tagsRow.classList.add("litm-render--hero__theme-tags");
				for (const tag of powerTags) {
					tagsRow.appendChild(tagSpan(tag.name, "litm-power_tag"));
				}
				themeEl.appendChild(tagsRow);
			}

			// Weakness tags
			const weakTags =
				theme.system.weaknessTags?.filter((tag) => tag.name) ?? [];
			if (weakTags.length) {
				const tagsRow = document.createElement("div");
				tagsRow.classList.add("litm-render--hero__theme-tags");
				for (const tag of weakTags) {
					tagsRow.appendChild(tagSpan(tag.name, "litm-weakness_tag"));
				}
				themeEl.appendChild(tagsRow);
			}

			themesContainer.appendChild(themeEl);
		}

		container.appendChild(themesContainer);
	}

	// ── Story Tags & Statuses ──
	const storyTags = sys.storyTags ?? [];
	const statuses = sys.statusEffects ?? [];
	if (storyTags.length || statuses.length) {
		const section = document.createElement("div");
		section.classList.add("litm-render--hero__story-tags");

		for (const tag of storyTags) {
			section.appendChild(tagSpan(tag.name, "litm-tag"));
		}
		for (const status of statuses) {
			const name = status.value
				? `${status.name}-${status.value}`
				: status.name;
			section.appendChild(tagSpan(name, "litm-status"));
		}

		container.appendChild(section);
	}

	return container;
}
