import { enrichHTML, localize as t } from "../../utils.js";
import { sectionHeader, tagSpan } from "./renderer-utils.js";

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

	if (game.user.isGM) {
		const sendBtn = document.createElement("button");
		sendBtn.type = "button";
		sendBtn.classList.add("litm-render--action__send");
		sendBtn.dataset.renderAction = "send-roll-request";
		sendBtn.dataset.uuid = item.uuid;
		sendBtn.dataset.tooltip = t("LITM.Actions.request_dialog_title");
		sendBtn.setAttribute(
			"aria-label",
			t("LITM.Actions.request_dialog_title"),
		);
		sendBtn.innerHTML = '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i>';
		container.appendChild(sendBtn);
	}

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
			for (const name of positiveTags) tags.appendChild(tagSpan(name, "litm-power_tag"));
			container.appendChild(tags);
		}
		if (negativeTags.length) {
			const tags = document.createElement("div");
			tags.classList.add("litm-render--action__tags");
			for (const name of negativeTags) tags.appendChild(tagSpan(name, "litm-weakness_tag"));
			container.appendChild(tags);
		}
	}

	// Successes
	const successes = sys.successes ?? [];
	if (successes.length) {
		container.appendChild(sectionHeader(t("LITM.Actions.successes")));

		const grouped = new Map();
		for (const s of successes) {
			const list = grouped.get(s.quality) ?? [];
			list.push(s);
			grouped.set(s.quality, list);
		}

		for (const quality of ["quick", "detailed"]) {
			const items = grouped.get(quality);
			if (!items) continue;
			for (const s of items) container.appendChild(_successEntry(s));
		}

		const feats = grouped.get("extraFeat");
		if (feats?.length) {
			const sub = document.createElement("p");
			sub.classList.add("litm-render--action__subhead");
			sub.textContent = t("LITM.Actions.qualities.extraFeat");
			container.appendChild(sub);

			const ul = document.createElement("ul");
			ul.classList.add("litm-render--action__feats");
			for (const f of feats) {
				const li = document.createElement("li");
				if (f.label) {
					const strong = document.createElement("strong");
					strong.textContent = f.label;
					li.appendChild(strong);
					if (f.description) li.appendChild(document.createTextNode(`. ${f.description}`));
				} else if (f.description) {
					li.textContent = f.description;
				} else {
					li.textContent = t(`LITM.Actions.verbs.${f.verb}`);
				}
				ul.appendChild(li);
			}
			container.appendChild(ul);
		}
	}

	// Consequences
	const consequences = sys.consequences ?? [];
	if (consequences.length) {
		container.appendChild(sectionHeader(t("LITM.Terms.consequences")));
		const ul = document.createElement("ul");
		ul.classList.add("litm-render--action__consequences");
		for (const c of consequences) {
			const li = document.createElement("li");
			li.textContent = c;
			ul.appendChild(li);
		}
		container.appendChild(ul);
	}

	return container;
}

/**
 * Render a single non-extraFeat success entry — small-caps verb followed
 * by inline label/description.
 */
function _successEntry(s) {
	const p = document.createElement("p");
	p.classList.add("litm-render--action__success");
	const verb = document.createElement("strong");
	verb.classList.add("litm-render--action__verb");
	verb.textContent = t(`LITM.Actions.verbs.${s.verb}`);
	p.appendChild(verb);
	if (s.label) p.appendChild(document.createTextNode(` ${s.label}`));
	if (s.description) p.appendChild(document.createTextNode(s.label ? `. ${s.description}` : ` ${s.description}`));
	return p;
}
