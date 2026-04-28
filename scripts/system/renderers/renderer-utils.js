/**
 * Creates a tag span matching the hero play sheet pattern.
 * @param {string} name - Tag name
 * @param {string} type - Tag CSS class (litm-power_tag, litm-weakness_tag, etc.)
 * @returns {HTMLElement}
 */
export function tagSpan(name, type) {
	const span = document.createElement("span");
	span.classList.add(type);
	span.dataset.text = name;
	span.draggable = true;
	span.textContent = name;
	return span;
}

/**
 * Creates a section divider with a centered label.
 * @param {string} label
 * @returns {HTMLElement}
 */
export function sectionHeader(label) {
	const el = document.createElement("div");
	el.classList.add("litm-render__section-header");
	el.textContent = label;
	return el;
}

/**
 * Bootstrap an actor render card container with optional portrait.
 *
 * Click handling is wired via a delegated body-level listener registered in
 * `Enrichers.register()` — the enriched card lives inside a string returned
 * from `TextEditor.enrichHTML`, so DOM event listeners attached at enrich
 * time would be lost on serialization.
 * @param {Actor} actor
 * @param {string} typeClass - CSS modifier class (e.g. "litm-render--hero")
 * @returns {{ container: HTMLElement, headerText: HTMLElement }}
 */
export function makeActorCard(actor, typeClass) {
	const hasCustomImage = actor.img !== CONFIG.litmv2.assets.icons.defaultActor;

	const container = document.createElement("div");
	container.classList.add("litm", "litm-render", "litm-render--card", typeClass);
	container.dataset.uuid = actor.uuid;
	container.dataset.renderAction = "open-sheet";
	container.dataset.tooltip = game.i18n.localize("LITM.Ui.click_to_view_actor");
	container.setAttribute("role", "button");
	container.setAttribute("tabindex", "0");

	const header = document.createElement("div");
	header.classList.add(`${typeClass}__header`);

	if (hasCustomImage) {
		const img = document.createElement("img");
		img.classList.add(`${typeClass}__portrait`);
		img.src = actor.img;
		header.appendChild(img);
	}

	const headerText = document.createElement("div");
	headerText.classList.add(`${typeClass}__header-text`);

	const title = document.createElement("h3");
	title.classList.add("litm-render__title");
	title.textContent = actor.name;
	headerText.appendChild(title);

	header.appendChild(headerText);
	container.appendChild(header);

	return { container, headerText };
}
