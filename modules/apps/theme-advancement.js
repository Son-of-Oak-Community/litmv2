import {
	fellowshipTagEffect,
	powerTagEffect,
	weaknessTagEffect,
} from "../active-effects/effect-factories.js";
import { settleNascent } from "../item/theme/nascent-theme.js";
import {
	findThemebookByName,
	localize as t,
	toQuestionOptions,
} from "../utils.js";
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
 * offered while one is left to gain or to activate; Reset while a quest
 * track has a mark to clear.
 * @param {Item} theme
 * @param {{ hasSpecials: boolean }} options
 * @returns {string[]}
 */
export function improveOptions(theme, { hasSpecials }) {
	if (theme.system?.isNascent) return ["power"];
	return OPTIONS.map((o) => o.value).filter((value) => {
		if (value === "promise") return !theme.system?.isFellowship;
		if (value === "special") return hasSpecials;
		if (value === "reset") return resettableTracks(theme).length > 0;
		return true;
	});
}

/**
 * The quest tracks Reset can clear: the ones with a mark on them.
 * @param {Item} theme
 * @returns {("abandon"|"milestone")[]}
 */
function resettableTracks(theme) {
	const tracks = theme.system?.quest?.tracks ?? {};
	return ["abandon", "milestone"].filter((k) => (tracks[k]?.value ?? 0) > 0);
}

/**
 * The tags an improvement may rewrite (p.193): a power or weakness tag the
 * theme has gained. Never the title tag: it is the theme's name, and a new
 * title is Evolve's.
 * @param {Item} theme
 * @returns {{kind: string, id: string, name: string}[]}
 */
function rewritableTags(theme) {
	return getRevisableParts(theme).filter((p) => p.kind !== "special");
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
			unmarkOwed: ThemeAdvancementApp.#onUnmarkOwed,
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
			canUnmarkOwed: (theme.system?.owedPowerTags ?? 0) > 0,
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
				? (rewriteSelect.selectedOptions[0]?.textContent ?? "")
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
	 * Spend what pays for this improvement, together with the theme's own
	 * changes (tracks, Special Improvements), in one write. A power tag a
	 * nascent theme owed (Core Book p.192) settles that debt and leaves the
	 * Improve track alone; anything else spends the full track. This runs
	 * before the improvement's other writes, so one that fails part-way never
	 * leaves the improvement granted and the Improve there to spend again.
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
		await theme.update(updateData);
	}

	/**
	 * Take back a power tag a nascent theme owes, without adding one: for an
	 * Improve box marked by mistake. The owed marks never show on the track,
	 * so this is the only way to undo one.
	 */
	static async #onUnmarkOwed() {
		const theme = game.actors.get(this.actorId)?.items.get(this.themeId);
		const owed = theme?.system?.owedPowerTags ?? 0;
		if (owed <= 0) return;
		await theme.update({ "system.nascentPending": owed - 1 });
		this.close();
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
		const renames =
			rewrite && rewriteName !== rewrite.name
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
				// Only a track with marks on it; an Improve spent clearing an
				// empty track buys nothing.
				const marked = resettableTracks(theme).filter((k) =>
					k === "abandon" ? fd.resetAbandon : fd.resetMilestone,
				);
				if (!marked.length) {
					ui.notifications?.warn(t("LITM.Ui.improve_reset_nothing"));
					return;
				}
				for (const k of marked)
					updateData[`system.quest.tracks.${k}.value`] = 0;
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

		// Spend first, then grant: see #spendImprove.
		await ThemeAdvancementApp.#spendImprove(theme, updateData, {
			paysOwedTag,
		});
		for (const step of apply) await step();
		if (renames.length)
			await theme.updateEmbeddedDocuments("ActiveEffect", renames);
		// A third power tag ends the nascent stage. The effect hook does this
		// too; settling here keeps it from depending on the hook's timing.
		await settleNascent(theme);
		Hooks.callAll("litm.themeAdvanced", theme.actor, theme, updateData);
		this.close();
	}

	static #onCancel() {
		this.close();
	}
}
