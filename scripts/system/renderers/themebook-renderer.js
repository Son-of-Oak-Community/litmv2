import { localize as t } from "../../utils.js";

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
 * Renders a lettered question list (A, B, C…).
 * @param {string[]} questions
 * @returns {HTMLElement}
 */
function questionList(questions) {
	const ul = document.createElement("ul");
	ul.classList.add("litm-render--themebook__questions");
	let letter = 0;
	for (const q of questions) {
		if (!q?.trim()) continue;
		const li = document.createElement("li");
		const mark = document.createElement("span");
		mark.classList.add("litm-render--themebook__letter");
		mark.textContent = String.fromCharCode(65 + letter);
		li.appendChild(mark);
		li.appendChild(document.createTextNode(` ${q}`));
		ul.appendChild(li);
		letter++;
	}
	return ul;
}

/**
 * Renders a Themebook item as an embed card.
 * Shows level, name, envisioning tags, description, power/weakness questions,
 * quest ideas, and special improvements.
 * @param {Item} item - A themebook item document
 * @returns {HTMLElement}
 */
export function renderThemebook(item) {
	const sys = item.system;

	const container = document.createElement("div");
	container.classList.add("litm", "litm-render", "litm-render--themebook");

	// Level label + Title
	if (sys.theme_level) {
		const level = document.createElement("div");
		level.classList.add("litm-render--themebook__level");
		const levelName =
			sys.theme_level.charAt(0).toUpperCase() + sys.theme_level.slice(1);
		level.textContent = `${levelName} ${t("LITM.Terms.themebook")}`;
		container.appendChild(level);
	}

	const title = document.createElement("h3");
	title.classList.add("litm-render__title", "litm-render--themebook__title");
	title.textContent = item.name;
	container.appendChild(title);

	// Envisioning tags
	const envTags = sys.envisioningTags?.filter((e) => e) ?? [];
	if (envTags.length) {
		const env = document.createElement("div");
		env.classList.add("litm-render--themebook__envisioning");
		env.textContent = envTags.join(" \u2726 ");
		container.appendChild(env);
	}

	// Description
	if (sys.description) {
		const desc = document.createElement("div");
		desc.classList.add("litm-render--themebook__description");
		desc.innerHTML = sys.description;
		container.appendChild(desc);
	}

	// Power Tag Questions
	const powerQs = sys.powerTagQuestions?.filter((q) => q?.trim()) ?? [];
	if (powerQs.length) {
		container.appendChild(sectionHeader(t("LITM.Ui.power_tag_questions")));
		container.appendChild(questionList(sys.powerTagQuestions));
	}

	// Weakness Tag Questions
	const weakQs = sys.weaknessTagQuestions?.filter((q) => q?.trim()) ?? [];
	if (weakQs.length) {
		container.appendChild(sectionHeader(t("LITM.Ui.weakness_tag_questions")));
		container.appendChild(questionList(sys.weaknessTagQuestions));
	}

	// Quest Ideas
	const quests = sys.questIdeas?.filter((q) => q?.trim()) ?? [];
	if (quests.length) {
		container.appendChild(sectionHeader(t("LITM.Ui.quest_ideas")));
		const ul = document.createElement("ul");
		ul.classList.add("litm-render--themebook__quests");
		for (const q of quests) {
			if (!q?.trim()) continue;
			const li = document.createElement("li");
			li.textContent = q;
			ul.appendChild(li);
		}
		container.appendChild(ul);
	}

	// Special Improvements
	const improvements = sys.specialImprovements?.filter((s) => s?.name) ?? [];
	if (improvements.length) {
		container.appendChild(sectionHeader(t("LITM.Ui.special_improvements")));
		const list = document.createElement("ul");
		list.classList.add("litm-render--themebook__improvements");
		for (const imp of improvements) {
			const li = document.createElement("li");
			const name = document.createElement("strong");
			name.textContent = imp.name;
			li.appendChild(name);
			if (imp.description) {
				li.appendChild(document.createTextNode(`: ${imp.description}`));
			}
			list.appendChild(li);
		}
		container.appendChild(list);
	}

	return container;
}
