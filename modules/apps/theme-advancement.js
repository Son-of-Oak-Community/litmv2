import {
	fellowshipTagEffect,
	powerTagEffect,
	weaknessTagEffect,
} from "../active-effects/effect-factories.js";
import { NASCENT_POWER_TAGS } from "../item/theme/theme-data.js";
import { findThemebookByName, localize as t, toQuestionOptions } from "../utils.js";
import { applyPromiseToActor, showForMode } from "./theme-evolution.js";
import { getRevisableParts, PROMISE_MAX } from "./theme-evolution-rules.js";

/** Improvement paths, in the Core Book's order (p.193). */
const OPTIONS = [
	{ value: "power", icon: "fa-solid fa-tag" },
	{ value: "weakness", icon: "fa-solid fa-heart-crack" },
	{ value: "special", icon: "fa-solid fa-medal" },
	{ value: "reset", icon: "fa-solid fa-rotate-left" },
	{ value: "promise", icon: "fa-solid fa-sun" },
];

/**
 * The improvements a theme may take. A nascent theme only gains power tags
 * (p.192); the Fellowship theme never marks Promise; a Special Improvement is
 * offered while one is left to gain or to activate.
 * @param {Item} theme
 * @param {{ hasSpecials: boolean }} options
 * @returns {string[]}
 */
export function improveOptions(theme, { hasSpecials }) {
	if (theme.system?.isNascent) return ["power"];
	return OPTIONS.map((o) => o.value).filter((value) => {
		if (value === "promise") return !theme.system?.isFellowship;
		if (value === "special") return hasSpecials;
		return true;
	});
}

/**
 * The tags an improvement may rewrite (p.193): the title tag, then the
 * theme's gained power and weakness tags.
 * @param {Item} theme
 * @returns {{kind: string, id: string, name: string}[]}
 */
function rewritableTags(theme) {
	const title = theme.system?.themeTag;
	return [
		...(title ? [{ kind: "title", id: title.id, name: title.name }] : []),
		...getRevisableParts(theme).filter((p) => p.kind !== "special"),
	];
}

export class ThemeAdvancementApp extends foundry.applications.api.HandlebarsApplicationMixin(
	foundry.applications.api.ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-theme-advancement",
		classes: ["litm", "litm-theme-advancement"],
		tag: "form",
		window: {
			title: "LITM.Ui.theme_advancement_title",
			resizable: true,
		},
		position: {
			width: 560,
			height: "auto",
		},
		actions: {
			confirm: ThemeAdvancementApp.#onConfirm,
			cancel: ThemeAdvancementApp.#onCancel,
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/apps/theme-advancement.html",
			scrollable: [""],
		},
	};

	constructor(options = {}) {
		super(options);
		this.actorId = options.actorId;
		this.themeId = options.themeId;
		this._selectedThemebook = null;
	}

	async _prepareContext(_options) {
		const actor = game.actors.get(this.actorId);
		const theme = actor?.items.get(this.themeId);
		if (!actor || !theme) {
			return { theme: { name: "", img: "" }, canSelect: false, options: [] };
		}

		const themebookName = theme.system?.themebook || "";
		const selectedThemebook = await findThemebookByName(themebookName);
		this._selectedThemebook = selectedThemebook;

		const existing = theme.system?.specialImprovements || [];
		const specialImprovementOptions =
			selectedThemebook?.system?.specialImprovements
				?.map((entry, index) => ({
					value: String(index),
					label: entry?.name || entry?.description || `#${index + 1}`,
					name: entry?.name || "",
					description: entry?.description || "",
				}))
				.filter(
					(entry) =>
						(entry.name || entry.description) &&
						!existing.some(
							(e) =>
								e.name === entry.name && e.description === entry.description,
						),
				) || [];
		const specialImprovementDescriptions = Object.fromEntries(
			specialImprovementOptions.map((opt) => [opt.value, opt.description]),
		);

		const toOption = (fallbackKey) => (tag) => ({
			value: tag.id,
			label: tag.name || t(fallbackKey),
		});
		const powerTags = theme.system?.powerTags || [];
		const weaknessTags = theme.system?.weaknessTags || [];
		// Only a disabled tag is inactive; a scratched one is still gained.
		const inactivePowerTags = powerTags
			.filter((tag) => tag.disabled)
			.map(toOption("LITM.Ui.name_power"));
		const inactiveWeaknessTags = weaknessTags
			.filter((tag) => tag.disabled)
			.map(toOption("LITM.Ui.name_weakness"));
		const activeWeaknessTags = weaknessTags
			.filter((tag) => !tag.disabled)
			.map(toOption("LITM.Ui.name_weakness"));
		const inactiveSpecialImprovements = existing
			.map((improvement, index) => ({
				value: String(index),
				label: improvement.name || t("LITM.Ui.improvement_name"),
				isActive: improvement.isActive,
			}))
			.filter((entry) => !entry.isActive);

		const allPowerQuestions =
			selectedThemebook?.system?.powerTagQuestions || [];
		const allWeaknessQuestions =
			selectedThemebook?.system?.weaknessTagQuestions || [];
		const questionTexts = (questions, from) =>
			Object.fromEntries(
				questions
					.map((q, i) => [String(i), q])
					.filter(([i, q]) => Number(i) >= from && `${q ?? ""}`.trim()),
			);

		const isNascent = !!theme.system?.isNascent;
		const available = improveOptions(theme, {
			hasSpecials:
				specialImprovementOptions.length > 0 ||
				inactiveSpecialImprovements.length > 0,
		});
		const currentPromise = actor.system?.promise ?? 0;

		return {
			theme,
			themebookName,
			canSelect: !!theme.system?.canAdvance,
			// A nascent theme only ever gains power tags (Core Book p.192).
			restrictedToPowerTag: isNascent,
			options: OPTIONS.filter((o) => available.includes(o.value)).map((o) => ({
				...o,
				label: t(`LITM.Ui.improve_option_${o.value}`),
				consequence: t(`LITM.Ui.improve_option_${o.value}_consequence`),
			})),
			defaultOption: available[0],
			specialImprovementOptions,
			specialImprovementDescriptions,
			inactiveSpecialImprovements,
			inactivePowerTags,
			inactiveWeaknessTags,
			activeWeaknessTags,
			powerQuestionOptions: toQuestionOptions(allPowerQuestions, 1),
			weaknessQuestionOptions: toQuestionOptions(allWeaknessQuestions, 0),
			powerQuestionTexts: questionTexts(allPowerQuestions, 1),
			weaknessQuestionTexts: questionTexts(allWeaknessQuestions, 0),
			tracks: theme.system?.quest?.tracks ?? {},
			// Whenever a theme improves, one of its tags may be rewritten (p.193).
			rewritable: rewritableTags(theme),
			currentPromise,
			promiseAfter: Math.min(PROMISE_MAX, currentPromise + 1),
			promiseReachesMof: currentPromise === PROMISE_MAX - 1,
			promiseBanked: currentPromise >= PROMISE_MAX,
		};
	}

	_onRender(context, options) {
		super._onRender(context, options);
		const html = this.element;

		const selected = () =>
			html.querySelector("input[name='option']:checked")?.value ??
			html.querySelector("input[name='option']")?.value;
		showForMode(html, selected());
		for (const radio of html.querySelectorAll("input[name='option']")) {
			radio.addEventListener("change", () => showForMode(html, selected()));
		}

		for (const select of html.querySelectorAll("select[data-questions]")) {
			select.addEventListener("change", () => {
				const input = select
					.closest(".form-group")
					?.querySelector("input[type='text']");
				if (!input) return;
				const questions = JSON.parse(select.dataset.questions || "{}");
				input.placeholder = questions[select.value] || "";
			});
		}

		// Start the rewrite from the chosen tag's current wording.
		const rewriteSelect = html.querySelector("select[name='rewriteTag']");
		const rewriteInput = html.querySelector("input[name='rewriteName']");
		rewriteSelect?.addEventListener("change", () => {
			if (!rewriteInput) return;
			rewriteInput.value = rewriteSelect.value
				? rewriteSelect.selectedOptions[0]?.textContent ?? ""
				: "";
		});

		const improvementSelect = html.querySelector("select[name='special']");
		const descriptionEl = html.querySelector(
			"[data-role='special-improvement-description']",
		);
		if (improvementSelect && descriptionEl) {
			const descriptions = JSON.parse(
				improvementSelect.dataset.descriptions || "{}",
			);
			improvementSelect.addEventListener("change", () => {
				const desc = descriptions[improvementSelect.value] || "";
				descriptionEl.textContent = desc;
				descriptionEl.hidden = !desc;
			});
		}
	}

	/**
	 * Guard: resolve theme and check if advancement is available.
	 * Returns the theme if advancement can proceed, null otherwise.
	 * @returns {Item|null}
	 */
	static #getAdvancableTheme() {
		const theme = game.actors.get(this.actorId)?.items.get(this.themeId);
		return theme?.system?.canAdvance ? theme : null;
	}

	/**
	 * Spend what paid for this improvement and fire the advancement hook. A
	 * power tag a nascent theme owed (Core Book p.192) settles that debt and
	 * leaves the Improve track alone; anything else spends the full track.
	 * A theme that now has three power tags is no longer nascent.
	 * The new tag is already on `theme` when this runs, so whether it paid an
	 * owed tag is decided by the caller before it was added.
	 */
	static async #spendImprove(
		theme,
		updateData = {},
		{ paysOwedTag = false } = {},
	) {
		if (paysOwedTag)
			updateData["system.nascentPending"] = Math.max(
				0,
				(theme.system?.nascentPending || 0) - 1,
			);
		else updateData["system.improve.value"] = 0;
		if (
			(theme.system?.nascentImprovements || 0) > 0 &&
			(theme.system?.powerTagCount ?? 0) >= NASCENT_POWER_TAGS
		) {
			updateData["system.nascentImprovements"] = 0;
			updateData["system.nascentPending"] = 0;
		}
		await theme.update(updateData);
		Hooks.callAll("litm.themeAdvanced", theme.actor, theme, updateData);
	}

	/**
	 * Apply the chosen improvement and the optional tag rewrite, then spend
	 * the Improve. Nothing changes when the form is incomplete. A second click
	 * while the first is saving is ignored, so one Improve buys one improvement.
	 */
	static async #onConfirm(_event, button) {
		if (this._submitting) return;
		this._submitting = true;
		if (button) button.disabled = true;
		try {
			await ThemeAdvancementApp.#applyImprovement.call(this);
		} finally {
			this._submitting = false;
			if (button?.isConnected) button.disabled = false;
		}
	}

	static async #applyImprovement() {
		const theme = ThemeAdvancementApp.#getAdvancableTheme.call(this);
		if (!theme) return;
		const fd = new foundry.applications.ux.FormDataExtended(this.element)
			.object;
		const text = (key) => `${fd[key] ?? ""}`.trim();
		const option = theme.system?.isNascent ? "power" : text("option");
		const isFellowship = !!theme.system?.isFellowship;

		// One tag at most, chosen in the form (p.193).
		const rewrite = rewritableTags(theme).find(
			(p) => p.id === text("rewriteTag"),
		);
		const rewriteName = text("rewriteName");
		if (rewrite && !rewriteName) {
			ui.notifications?.warn(t("LITM.Ui.improve_rewrite_name"));
			return;
		}
		if (!rewrite && rewriteName) {
			ui.notifications?.warn(t("LITM.Ui.improve_rewrite_pick_tag"));
			return;
		}
		// A removed tag has nothing left to rewrite.
		if (
			option === "weakness" &&
			rewrite &&
			rewrite.id === text("removeWeakness")
		) {
			ui.notifications?.warn(t("LITM.Ui.improve_rewrite_removed"));
			return;
		}
		const renamed = rewrite && rewriteName !== rewrite.name;
		// The title tag is the theme's name; renaming the theme renames it
		// (item-hooks keeps them in step).
		const renames =
			renamed && rewrite.kind !== "title"
				? [{ _id: rewrite.id, name: rewriteName }]
				: [];

		// Exactly one of the section's fields must be filled.
		const pickOne = (keys, warning) => {
			const filled = keys.filter((key) => text(key));
			if (filled.length === 1) return filled[0];
			ui.notifications?.warn(t(warning));
			return null;
		};

		const updateData = {};
		let paysOwedTag = false;
		const apply = [];

		switch (option) {
			case "power": {
				const key = pickOne(
					["powerName", "activatePower"],
					"LITM.Ui.improve_choose_power",
				);
				if (!key) return;
				const factory = isFellowship ? fellowshipTagEffect : powerTagEffect;
				apply.push(() =>
					key === "powerName"
						? theme.createEmbeddedDocuments("ActiveEffect", [
								factory({
									name: text("powerName"),
									isActive: true,
									question: text("powerQuestion"),
								}),
							])
						: theme.updateEmbeddedDocuments("ActiveEffect", [
								{ _id: text("activatePower"), disabled: false },
							]),
				);
				paysOwedTag = theme.system.owedPowerTags > 0;
				break;
			}
			case "weakness": {
				const key = pickOne(
					["weaknessName", "removeWeakness", "activateWeakness"],
					"LITM.Ui.improve_choose_weakness",
				);
				if (!key) return;
				apply.push(() => {
					if (key === "weaknessName")
						return theme.createEmbeddedDocuments("ActiveEffect", [
							weaknessTagEffect({
								name: text("weaknessName"),
								isActive: true,
								question: text("weaknessQuestion"),
							}),
						]);
					if (key === "removeWeakness")
						return theme.deleteEmbeddedDocuments("ActiveEffect", [
							text("removeWeakness"),
						]);
					return theme.updateEmbeddedDocuments("ActiveEffect", [
						{ _id: text("activateWeakness"), disabled: false },
					]);
				});
				break;
			}
			case "special": {
				const key = pickOne(
					["special", "activateSpecial"],
					"LITM.Ui.improve_choose_special",
				);
				if (!key) return;
				const specials = [...(theme.system?.specialImprovements || [])];
				const index = Number(text(key));
				if (key === "special") {
					const entry =
						this._selectedThemebook?.system?.specialImprovements?.[index];
					const taken = specials.some(
						(e) =>
							e.name === entry?.name && e.description === entry?.description,
					);
					if (!entry || taken) {
						ui.notifications?.warn(t("LITM.Ui.improve_choose_special"));
						return;
					}
					specials.push({
						name: entry.name || "",
						description: entry.description || "",
						isActive: true,
					});
				} else {
					if (!specials[index]) {
						ui.notifications?.warn(t("LITM.Ui.improve_choose_special"));
						return;
					}
					specials[index] = { ...specials[index], isActive: true };
				}
				updateData["system.specialImprovements"] = specials;
				break;
			}
			case "reset": {
				if (!fd.resetAbandon && !fd.resetMilestone) {
					ui.notifications?.warn(t("LITM.Ui.improve_choose_reset"));
					return;
				}
				if (fd.resetAbandon)
					updateData["system.quest.tracks.abandon.value"] = 0;
				if (fd.resetMilestone)
					updateData["system.quest.tracks.milestone.value"] = 0;
				break;
			}
			case "promise": {
				// The Fellowship theme cannot mark Promise (p.193).
				if (isFellowship || !theme.actor) return;
				apply.push(() => applyPromiseToActor(theme.actor, 1));
				break;
			}
			default:
				return;
		}

		for (const step of apply) await step();
		if (renames.length)
			await theme.updateEmbeddedDocuments("ActiveEffect", renames);
		if (renamed && rewrite.kind === "title") updateData.name = rewriteName;
		await ThemeAdvancementApp.#spendImprove(theme, updateData, {
			paysOwedTag,
		});
		this.close();
	}

	static #onCancel() {
		this.close();
	}
}
