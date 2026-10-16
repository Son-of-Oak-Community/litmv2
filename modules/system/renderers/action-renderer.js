import { callForRollLabel } from "../../apps/roll/roll-request.js";
import { enrichHTML, localize as t } from "../../utils.js";
import { proseChipsHtml, sectionHeader, tagSpan } from "./renderer-utils.js";

/**
 * Renders an Action item as a read-only embed card. Used by the @render
 * enricher's popout and by the roll dialog's "view action" button.
 * Layout follows the conventions of the other embed renderers — title
 * via `litm-render__title`, sections via `sectionHeader`, suggested
 * tags as proper `tagSpan` chrome.
 *
 * @param {Item} item  An action item document
 * @returns {Promise<HTMLElement>}
 */
export async function renderAction(item) {
	const sys = item.system;

	const container = document.createElement("div");
	container.classList.add(
		"litm",
		"litm-render",
		"litm-render--card",
		"litm-render--action",
	);

	const title = document.createElement("h3");
	title.classList.add("litm-render__title");
	title.textContent = item.name;
	container.appendChild(title);

	// Practitioners hint for rotes
	if (sys.isRote && sys.practitioners) {
		const practitioners = document.createElement("p");
		practitioners.classList.add("litm-render--action__practitioners");
		practitioners.textContent = sys.practitioners;
		container.appendChild(practitioners);
	}

	// Examples — middle-dot list under the title
	const examples = sys.actionExamples?.filter(Boolean) ?? [];
	if (examples.length) {
		const p = document.createElement("p");
		p.classList.add("litm--action-examples");
		examples.forEach((ex) => {
			const span = document.createElement("span");
			span.classList.add("litm--action-example-chip");
			span.textContent = ex;
			p.appendChild(span);
		});
		container.appendChild(p);
	}

	// Description (rich text)
	if (sys.description) {
		const desc = document.createElement("div");
		desc.classList.add("litm-render--action__description");
		desc.innerHTML = await enrichHTML(sys.description, item);
		container.appendChild(desc);
	}

	// Power
	const positiveTags = (sys.power?.positiveTags ?? [])
		.map((e) => e.label?.trim())
		.filter(Boolean);
	const negativeTags = (sys.power?.negativeTags ?? [])
		.map((e) => e.label?.trim())
		.filter(Boolean);
	if (positiveTags.length || negativeTags.length) {
		container.appendChild(sectionHeader(t("LITM.Actions.power")));
		if (positiveTags.length) {
			const tags = document.createElement("div");
			tags.classList.add("litm-render--action__tags");
			for (const name of positiveTags)
				tags.appendChild(tagSpan(name, "litm-power_tag"));
			container.appendChild(tags);
		}
		if (negativeTags.length) {
			const tags = document.createElement("div");
			tags.classList.add("litm-render--action__tags");
			for (const name of negativeTags)
				tags.appendChild(tagSpan(name, "litm-weakness_tag"));
			container.appendChild(tags);
		}
	}

	// Successes — flat list in author order; verb chip prefixes the prose.
	const successes = sys.successes ?? [];
	if (successes.length) {
		container.appendChild(sectionHeader(t("LITM.Actions.successes")));
		for (const s of successes) container.appendChild(_successEntry(s));
	}

	// Extra Feats — narrative-only bullets, prose rendered with chip markup.
	const extraFeats = sys.extraFeats ?? [];
	if (extraFeats.length) {
		container.appendChild(sectionHeader(t("LITM.Actions.extra_feats")));
		const ul = document.createElement("ul");
		ul.classList.add("litm-render--action__feats");
		for (const text of extraFeats) {
			const li = document.createElement("li");
			li.innerHTML = proseChipsHtml(text);
			ul.appendChild(li);
		}
		container.appendChild(ul);
	}

	// Consequences — same chip rendering as successes/feats.
	const consequences = sys.consequences ?? [];
	if (consequences.length) {
		container.appendChild(sectionHeader(t("LITM.Terms.consequences")));
		const ul = document.createElement("ul");
		ul.classList.add("litm-render--action__consequences");
		for (const c of consequences) {
			const li = document.createElement("li");
			li.innerHTML = proseChipsHtml(c);
			ul.appendChild(li);
		}
		container.appendChild(ul);
	}

	// GM call-for-roll, labelled and last, like the primary button on a chat card
	if (game.user.isGM) {
		const label = callForRollLabel(item.parent);
		const sendBtn = document.createElement("button");
		sendBtn.type = "button";
		sendBtn.classList.add("litm-render--action__send");
		sendBtn.dataset.renderAction = "send-roll-request";
		sendBtn.dataset.uuid = item.uuid;
		const icon = document.createElement("i");
		icon.classList.add("fa-solid", "fa-paper-plane");
		icon.setAttribute("aria-hidden", "true");
		sendBtn.append(icon, ` ${label}`);
		container.appendChild(sendBtn);
	}

	return container;
}

/**
 * Render a single success entry — small-caps verb followed by prose with
 * inline tag/status chips.
 */
function _successEntry(s) {
	const p = document.createElement("p");
	p.classList.add("litm-render--action__success");

	const verb = document.createElement("strong");
	verb.classList.add("litm-render--action__verb");
	verb.textContent = t(`LITM.Actions.verbs.${s.verb}`);
	p.appendChild(verb);

	if (s.text) {
		const prose = document.createElement("span");
		prose.classList.add("litm-render--action__success-text");
		prose.innerHTML = ` ${proseChipsHtml(s.text)}`;
		p.appendChild(prose);
	}
	return p;
}
