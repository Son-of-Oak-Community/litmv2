/**
 * Theme Evolution & Replacement Wizard.
 *
 * Implements Core Book p.189-192: when a theme's Milestone track is full
 * it can evolve; when its Abandon track is full it must be replaced. Both
 * paths also apply under "Inexorable Failure" (p.190) where the player
 * may choose either.
 *
 * Promise math (p.193):
 *   Evolve  → +1 (base) plus +1 per *optionally* traded extra
 *   Replace → +1 (base) plus +1 per *mandatorily* traded extra
 *   Extras are: power tags beyond the third, weakness tags beyond the
 *   first, and any Special Improvement on the discarded theme.
 *   Fellowship themes do not gain Promise (p.193).
 *
 * The wizard transforms the theme in place rather than deleting and
 * recreating — preserves the item's `_id` and any external references.
 */

import {
	powerTagEffect,
	weaknessTagEffect,
} from "../active-effects/effect-factories.js";
import { error } from "../logger.js";
import {
	buildTrackCompleteContent,
	detectTrackCompletion,
} from "../system/chat.js";
import {
	getDefaultThemeLevel,
	getThemeLevels,
	POWER_TAG_TYPES,
} from "../system/config.js";
import { queryItemsFromPacks, localize as t } from "../utils.js";
import {
	applyPromiseGain,
	availableModes,
	getRevisableParts,
	getTradeCaps,
	totalTradeCap,
} from "./theme-evolution-rules.js";

function getActor(app) {
	return game.actors.get(app.actorId) ?? null;
}

function getTheme(app) {
	return getActor(app)?.items.get(app.themeId) ?? null;
}

function currentMode(html) {
	const checked = html.querySelector("input[name='mode']:checked");
	return (
		checked?.value ||
		html.querySelector("input[name='mode']")?.value ||
		"evolve"
	);
}

function recomputePromiseSummary(html, context) {
	if (context.isFellowship) return;
	const mode = currentMode(html);
	let tradedCount;
	if (mode === "expand") {
		// Expand replaces the *target* theme via the same code path as
		// replace, so its Promise gain is the target's full rule cap —
		// not a per-tag opt-in. Mirror that here so the preview matches.
		const targetId = html.querySelector("select[name='expandTarget']")?.value;
		tradedCount = context.expandTargetExtras?.[targetId] ?? 0;
	} else if (mode === "replace") {
		// In replace the entire theme is wiped; Promise math is the rules
		// cap (extras beyond baseline) regardless of which specific tags.
		tradedCount = totalTradeCap(context.tradeCaps);
	} else {
		tradedCount = [...html.querySelectorAll("input[name^='trade-']:checked")]
			.length;
	}
	const gained = 1 + tradedCount;
	const current = context.currentPromise;
	const total = current + gained;
	const after = Math.min(total, 5);
	const overflow = Math.max(0, total - 5);
	const reachedFulfillment = total >= 5;

	const gainedEl = html.querySelector("[data-bind='promise-gained']");
	const afterEl = html.querySelector("[data-bind='promise-after']");
	const overflowEl = html.querySelector("[data-bind='promise-overflow']");
	const mofEl = html.querySelector("[data-bind='promise-mof']");
	if (gainedEl) gainedEl.textContent = String(gained);
	if (afterEl) afterEl.textContent = `${after} / 5`;
	if (overflowEl) {
		overflowEl.hidden = overflow === 0;
		overflowEl.textContent = overflow
			? game.i18n.format("LITM.Ui.evolution_promise_banked", { n: overflow })
			: "";
	}
	if (mofEl) mofEl.hidden = !reachedFulfillment;
}

/**
 * Enforce the per-kind trade cap (Core Book p.193) in the evolve UI:
 * once the player has marked the maximum tradable for a kind, any
 * remaining unchecked toggles of that kind are disabled until they free
 * a slot by unchecking. No-op in modes without per-tag toggles.
 */
function enforceTradeCaps(html, context) {
	const caps = context.tradeCaps ?? { power: 0, weakness: 0, special: 0 };
	const used = { power: 0, weakness: 0, special: 0 };
	for (const cb of html.querySelectorAll(
		".litm-theme-evolution__trade-row input[name^='trade-']:checked",
	)) {
		const kind = cb.closest(".litm-theme-evolution__trade-row")?.dataset.kind;
		if (kind in used) used[kind] += 1;
	}
	for (const cb of html.querySelectorAll(
		".litm-theme-evolution__trade-row input[name^='trade-']",
	)) {
		const row = cb.closest(".litm-theme-evolution__trade-row");
		const kind = row?.dataset.kind;
		if (!(kind in used)) continue;
		// Don't fight the replace-mode lock (those are externally disabled).
		if (row.dataset.modeLocked === "true") continue;
		const atCap = used[kind] >= caps[kind];
		cb.disabled = !cb.checked && atCap;
		row.classList.toggle("is-trade-cap", cb.disabled);
	}
}

function applyModeVisibility(html, context) {
	const { isFellowship } = context;
	const caps = context.tradeCaps ?? { power: 0, weakness: 0, special: 0 };
	const capsTotal = caps.power + caps.weakness + caps.special;
	const mode = currentMode(html);
	// Expand-only blocks (target picker, current-theme quest rewrite) show
	// only in expand mode. The standard "New Theme" fieldset applies to
	// the replacement theme in expand mode, and to the current theme
	// otherwise — the surrounding copy adapts in the template via mode
	// switches on the labels.
	for (const el of html.querySelectorAll("[data-show-when='expand']")) {
		el.hidden = mode !== "expand";
	}
	for (const el of html.querySelectorAll("[data-hide-when='expand']")) {
		el.hidden = mode === "expand";
	}
	for (const el of html.querySelectorAll("[data-hide-when='replace']")) {
		el.hidden = mode === "replace";
	}

	// Replace wipes the entire theme — name revisions are pointless, and
	// the per-tag trade toggles don't apply (Promise math uses the rule
	// cap, not a tag-by-tag opt-in). Disable the rename inputs so they
	// read as inert and locked.
	for (const row of html.querySelectorAll(".litm-theme-evolution__trade-row")) {
		const renameInput = row.querySelector("input[name^='rename-']");
		row.dataset.modeLocked = mode === "replace" ? "true" : "false";
		if (renameInput) renameInput.disabled = mode === "replace";
	}

	// Fellowship themes don't gain Promise, so trading is meaningless on
	// evolve (the section would just be a delete-tags shortcut). Hide the
	// whole fieldset in that case; keep it on replace (cleanup is required).
	const fieldset = html.querySelector("[data-role='trade-fieldset']");
	if (fieldset) {
		fieldset.hidden = isFellowship && mode === "evolve";
	}

	const tradeHint = html.querySelector("[data-role='trade-hint']");
	if (tradeHint) {
		if (isFellowship) {
			tradeHint.textContent =
				mode === "replace" ? t("LITM.Ui.evolution_cleanup_hint_replace") : "";
		} else if (mode === "replace") {
			tradeHint.textContent = game.i18n.format(
				"LITM.Ui.evolution_trade_hint_replace",
				{ extras: capsTotal },
			);
		} else {
			tradeHint.textContent = game.i18n.format(
				"LITM.Ui.evolution_trade_hint_evolve",
				{ power: caps.power, weakness: caps.weakness, special: caps.special },
			);
		}
	}
}

/**
 * Surface a small chat card when Promise overflow banks past a still-
 * unresolved Moment of Fulfillment. The sheet already shows a `+N`
 * pill — this just makes the change discoverable in chat instead of
 * silently mutating actor state.
 */
async function emitPromiseBankedChat(actor, banked) {
	const text = game.i18n.format("LITM.Ui.evolution_promise_banked_chat", {
		actor: actor.name,
		n: banked,
	});
	const content = await buildTrackCompleteContent({ text, type: "promise" });
	await foundry.documents.ChatMessage.create({
		content,
		speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
	});
}

/**
 * Apply an "expand" operation (Core Book p.190): keep the milestone-
 * completed theme largely intact (reset Milestone, rewrite Quest) and
 * replace one of the hero's other themes with a new theme that expands
 * on the evolved one. Promise math follows the replaced theme's extras
 * — the milestone theme itself does not mark Promise here, since per
 * the rules Promise is tied to the act of evolving or replacing a
 * theme, and the milestone theme is doing neither (just renormalizing).
 */
async function applyExpansion({
	actor,
	currentTheme,
	targetTheme,
	newCurrentQuest,
	newName,
	newThemebook,
	newLevel,
	newQuest,
}) {
	// 1) Renormalize the milestone-completed theme: track to 0, new Quest.
	await currentTheme.update({
		"system.quest.tracks.milestone.value": 0,
		"system.quest.description": newCurrentQuest,
	});

	// 2) Replace the target theme using the same path Replace mode takes,
	//    so Promise math and nascent-theme setup stay rules-faithful.
	const targetCaps = getTradeCaps(getRevisableParts(targetTheme));
	const syntheticTraded = Array.from(
		{ length: totalTradeCap(targetCaps) },
		(_, i) => ({ kind: "synthetic", id: `_${i}` }),
	);
	await applyTransformation({
		actor,
		theme: targetTheme,
		mode: "replace",
		newName,
		newThemebook,
		newLevel,
		newQuest,
		traded: syntheticTraded,
		renames: [],
		isFellowship: false,
		keepOldTitleAsPower: false,
		oldName: targetTheme.name,
	});
}

/**
 * Apply the full transformation in a defined order so the title-tag
 * auto-sync (item-hooks.js) and any track-completion hooks fire on
 * documents in a coherent state.
 */
async function applyTransformation({
	actor,
	theme,
	mode,
	newName,
	newThemebook,
	newLevel,
	newQuest,
	traded,
	renames = [],
	isFellowship,
	keepOldTitleAsPower = false,
	oldName = "",
}) {
	// 1) Compute Promise gain. Fellowship themes never mark Promise.
	const promiseGained = isFellowship ? 0 : 1 + traded.length;

	// 2) Apply evolve-mode renames to surviving tags before any deletes,
	//    so the player's revised names land on the kept effects.
	if (mode === "evolve" && renames.length) {
		const effectRenames = renames
			.filter((r) => r.kind === "power" || r.kind === "weakness")
			.map((r) => ({ _id: r.id, name: r.newName }));
		if (effectRenames.length) {
			await theme.updateEmbeddedDocuments("ActiveEffect", effectRenames);
		}
	}

	// 3) Delete traded effects (power + weakness).
	const effectIds = traded
		.filter((p) => p.kind === "power" || p.kind === "weakness")
		.map((p) => p.id);
	if (effectIds.length) {
		await theme.deleteEmbeddedDocuments("ActiveEffect", effectIds);
	}

	// 3) On replace: also delete remaining power and weakness effects
	//    (everything except the title tag) and clear special improvements.
	if (mode === "replace") {
		const wipeIds = [...theme.effects]
			.filter(
				(e) =>
					(POWER_TAG_TYPES.has(e.type) && !e.system.isTitleTag) ||
					e.type === "weakness_tag",
			)
			.map((e) => e.id);
		if (wipeIds.length) {
			await theme.deleteEmbeddedDocuments("ActiveEffect", wipeIds);
		}
	}

	// 4) Build the theme update payload. Title-tag auto-sync runs off
	//    the `name` change.
	const update = {
		name: newName,
		"system.themebook": newThemebook,
		"system.level": newLevel,
		"system.quest.description": newQuest,
		"system.quest.tracks.milestone.value": 0,
		"system.quest.tracks.abandon.value": 0,
	};

	if (mode === "evolve") {
		const tradedSpecialIdx = new Set(
			traded.filter((p) => p.kind === "special").map((p) => Number(p.id)),
		);
		const specialRenames = new Map(
			renames
				.filter((r) => r.kind === "special")
				.map((r) => [Number(r.id), r.newName]),
		);
		const nextSpecials = (theme.system?.specialImprovements ?? [])
			.map((si, idx) =>
				specialRenames.has(idx) ? { ...si, name: specialRenames.get(idx) } : si,
			)
			.filter((_, idx) => !tradedSpecialIdx.has(idx));
		update["system.specialImprovements"] = nextSpecials;
	} else {
		update["system.specialImprovements"] = [];
		update["system.nascentImprovements"] = 2;
		// A replaced theme is a wholly new nascent theme, so its Improve
		// track starts fresh. Evolution preserves the track since the
		// theme is the same one continuing in a new direction.
		update["system.improve.value"] = 0;
	}

	await theme.update(update);

	// 5) Replace mode: create a new weakness tag effect (one weakness is
	//    required for a nascent theme).
	if (mode === "replace") {
		await theme.createEmbeddedDocuments("ActiveEffect", [
			weaknessTagEffect({
				name: t("LITM.Ui.evolution_new_weakness_placeholder"),
				isActive: true,
			}),
		]);
	}

	// 5b) Inexorable Failure (Core Book p.190): when both Milestone and
	//     Abandon tracks were full, the player may keep the old title tag
	//     as a regular power tag on the new theme. Create it as an inactive
	//     extra power tag tied to the new theme.
	if (keepOldTitleAsPower && oldName) {
		await theme.createEmbeddedDocuments("ActiveEffect", [
			powerTagEffect({ name: oldName, isActive: true }),
		]);
	}

	// 6) Mark Promise on the hero. Per Core Book p.193, reaching 5 triggers
	//    a Moment of Fulfillment; once resolved, the track resets and "any
	//    remaining promise" is marked as usual. The schema caps `promise`
	//    at 5 — we bank the overflow in `pendingPromise`, and the hero
	//    sheet's MoF-entry handler picks it up when the player resolves.
	if (promiseGained > 0) {
		const {
			update: actorUpdate,
			newPromise,
			banked,
			reachedFulfillment,
		} = applyPromiseGain({
			currentPromise: actor.system?.promise ?? 0,
			currentPending: actor.system?.pendingPromise ?? 0,
			gained: promiseGained,
		});
		await actor.update(actorUpdate);

		if (reachedFulfillment) {
			const trackInfo = detectTrackCompletion(
				"system.promise",
				newPromise,
				actor,
				actor,
			);
			if (trackInfo) {
				Hooks.callAll("litm.trackCompleted", { actor, trackInfo });
			}
		} else if (banked > 0) {
			// The track was already at the cap when this Promise arrived,
			// so detectTrackCompletion correctly returns null (no crossing).
			// Surface a lightweight chat card so the player isn't left to
			// notice the +N indicator on their sheet on their own.
			await emitPromiseBankedChat(actor, banked);
		}
	}

	// 7) Surface the standard advancement hook so module authors can react.
	Hooks.callAll("litm.themeAdvanced", actor, theme, {
		...update,
		litmEvolution: { mode, promiseGained, tradedCount: traded.length },
	});

	const msgKey =
		mode === "replace"
			? "LITM.Ui.evolution_replaced_notification"
			: "LITM.Ui.evolution_evolved_notification";
	ui.notifications?.info(
		game.i18n.format(msgKey, { theme: newName, actor: actor.name }),
	);
}

export class ThemeEvolutionWizard extends foundry.applications.api.HandlebarsApplicationMixin(
	foundry.applications.api.ApplicationV2,
) {
	static DEFAULT_OPTIONS = {
		id: "litm-theme-evolution",
		classes: ["litm", "litm-theme-evolution"],
		tag: "form",
		window: {
			title: "LITM.Ui.theme_evolution_title",
			resizable: true,
		},
		position: {
			width: 560,
			height: "auto",
		},
		actions: {
			confirm: ThemeEvolutionWizard.#onConfirm,
			cancel: ThemeEvolutionWizard.#onCancel,
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/apps/theme-evolution.html",
			scrollable: [""],
		},
	};

	constructor(options = {}) {
		super(options);
		this.actorId = options.actorId;
		this.themeId = options.themeId;
		// Optional: chat message that triggered the wizard. On successful
		// confirmation, we flag the message so its footer button hides.
		this.messageId = options.messageId ?? null;
		this._themebooks = [];
		// Re-entrancy guard. #onConfirm runs several awaits in sequence;
		// without this, a second click during the in-flight transformation
		// would trigger duplicate document updates and chat cards.
		this._submitting = false;
	}

	get title() {
		const theme = getTheme(this);
		if (!theme) return t("LITM.Ui.theme_evolution_title");
		const { defaultMode, milestoneFull, abandonFull } = availableModes(theme);
		if (milestoneFull && abandonFull) {
			return t("LITM.Ui.theme_transformation_title");
		}
		return defaultMode === "replace"
			? t("LITM.Ui.theme_replacement_title")
			: t("LITM.Ui.theme_evolution_title");
	}

	async _prepareContext(_options) {
		const actor = getActor(this);
		const theme = getTheme(this);
		if (!actor || !theme || theme.type !== "theme") {
			// The actor/theme has been deleted (or never existed) between
			// the trigger and the open. Notify and close on the next tick
			// so we don't try to render an empty form.
			ui.notifications?.warn(t("LITM.Ui.evolution_target_missing"));
			queueMicrotask(() => this.close());
			return { canRender: false };
		}

		if (!this._themebooks.length) {
			this._themebooks = await queryItemsFromPacks({
				type: "themebook",
				indexFields: ["name", "system.theme_level"],
				map: (entry) => ({
					name: entry.name,
					label: entry.name,
					themeLevel: entry.system?.theme_level ?? "",
				}),
			});
		}

		// Group themebooks by their Might tier (theme_level on ThemebookData:
		// origin, adventure, greatness, or "variable") so the player sees at
		// a glance which Might each option implies. "Variable" themebooks
		// (Companion, etc.) are tier-agnostic and get their own group at the
		// end; anything else falls into "Other".
		const tierOrder = [...getThemeLevels(), "variable"];
		const buckets = new Map(tierOrder.map((k) => [k, []]));
		const ungrouped = [];
		for (const tb of this._themebooks) {
			const bucket = buckets.get(tb.themeLevel);
			if (bucket) bucket.push(tb);
			else ungrouped.push(tb);
		}
		const sortByLabel = (a, b) => a.label.localeCompare(b.label);
		const themebookGroups = tierOrder
			.map((tier) => ({
				tier,
				label: t(`LITM.Terms.${tier}`) || tier,
				options: buckets
					.get(tier)
					.sort(sortByLabel)
					.map((tb) => ({ value: tb.name, label: tb.label })),
			}))
			.filter((g) => g.options.length > 0);
		if (ungrouped.length) {
			themebookGroups.push({
				tier: "",
				label: t("LITM.Ui.evolution_themebook_other"),
				options: ungrouped
					.sort(sortByLabel)
					.map((tb) => ({ value: tb.name, label: tb.label })),
			});
		}

		const levels = getThemeLevels().map((key) => ({
			value: key,
			label: t(`LITM.Terms.${key}`) || key,
		}));

		const isFellowship = !!theme.system.isFellowship;
		const { defaultMode, milestoneFull, abandonFull } = availableModes(theme);
		const showModeSelect = milestoneFull && abandonFull;
		const revisable = getRevisableParts(theme);
		const tradeCaps = getTradeCaps(revisable);
		const totalCap = tradeCaps.power + tradeCaps.weakness + tradeCaps.special;

		// Expand (Core Book p.190) is an alternative to Evolve: keep this
		// theme largely as-is and instead replace one of the hero's OTHER
		// themes. Only offered when this theme is eligible to evolve
		// (Milestone full) and the hero has another non-fellowship theme.
		const otherThemes = actor.items
			.filter(
				(i) =>
					i.type === "theme" &&
					i.id !== this.themeId &&
					!i.system?.isFellowship,
			)
			.map((t) => ({ id: t.id, name: t.name }));
		// For each potential expand target, precompute the number of
		// "extras" the rules will trade in (the same value applyExpansion
		// passes to applyTransformation). The recompute step on the live
		// form reads this map keyed by target id so the preview matches
		// what actually applies on confirm.
		const expandTargetExtras = Object.fromEntries(
			otherThemes.map((ot) => {
				const target = actor.items.get(ot.id);
				return [
					ot.id,
					target ? totalTradeCap(getTradeCaps(getRevisableParts(target))) : 0,
				];
			}),
		);
		const expandAvailable =
			!isFellowship && milestoneFull && otherThemes.length > 0;

		const modeOptions = [
			{ value: "evolve", label: t("LITM.Ui.evolve_theme") },
			{ value: "replace", label: t("LITM.Ui.replace_theme") },
		];
		if (expandAvailable) {
			modeOptions.push({ value: "expand", label: t("LITM.Ui.expand_theme") });
		}

		return {
			canRender: true,
			actorId: this.actorId,
			themeId: this.themeId,
			theme,
			themebookName: theme.system?.themebook || "",
			isFellowship,
			currentPromise: actor.system?.promise ?? 0,
			defaultMode,
			showModeSelect,
			showPathPicker: showModeSelect || expandAvailable,
			milestoneFull,
			abandonFull,
			themebookGroups,
			levels,
			currentLevel: theme.system?.level || getDefaultThemeLevel(),
			revisable,
			tradeCaps,
			hasRevisable: revisable.length > 0,
			hasTradable: totalCap > 0,
			expandAvailable,
			otherThemes,
			expandTargetExtras,
			modeOptions,
		};
	}

	_onRender(context, options) {
		super._onRender(context, options);
		const html = this.element;
		if (!html) return;

		const refresh = () => {
			applyModeVisibility(html, context);
			enforceTradeCaps(html, context);
			recomputePromiseSummary(html, context);
		};
		for (const input of html.querySelectorAll(
			"input[name='mode'], input[name^='trade-'], select[name='expandTarget']",
		)) {
			input.addEventListener("change", refresh);
		}
		refresh();
	}

	static async #onCancel(_event, _target) {
		this.close();
	}

	static async #onConfirm(_event, _target) {
		if (this._submitting) return;
		this._submitting = true;
		const confirmBtn = this.element?.querySelector("[data-action='confirm']");
		if (confirmBtn) confirmBtn.disabled = true;
		try {
			await ThemeEvolutionWizard.#submit.call(this);
		} finally {
			// Always clear the flag. The button may already be detached if
			// the submit closed the wizard — re-enabling it is a harmless
			// no-op in that case, and necessary when submit aborted early
			// for a validation warning.
			this._submitting = false;
			if (confirmBtn?.isConnected) confirmBtn.disabled = false;
		}
	}

	static async #submit() {
		const html = this.element;
		const actor = getActor(this);
		const theme = getTheme(this);
		if (!actor || !theme) {
			error("ThemeEvolutionWizard: actor or theme not found");
			return;
		}

		const fd = new foundry.applications.ux.FormDataExtended(html).object;
		const mode = fd.mode || currentMode(html);
		const isFellowship = !!theme.system.isFellowship;
		const newName = `${fd.name ?? ""}`.trim();
		const newThemebook = `${fd.themebook ?? ""}`.trim();
		const newLevel = `${fd.level ?? ""}`.trim();
		const newQuest = `${fd.quest ?? ""}`;

		if (!newName) {
			ui.notifications?.warn(t("LITM.Ui.evolution_name_required"));
			return;
		}

		// Expand mode targets a different theme; validation pivots on that.
		if (mode === "expand") {
			const targetThemeId = `${fd.expandTarget ?? ""}`.trim();
			const targetTheme = actor.items.get(targetThemeId);
			if (!targetTheme) {
				ui.notifications?.warn(t("LITM.Ui.evolution_expand_target_required"));
				return;
			}
			if (newName.toLowerCase() === targetTheme.name.toLowerCase()) {
				ui.notifications?.warn(t("LITM.Ui.evolution_title_must_change"));
				return;
			}
			const newCurrentQuest = `${fd.thisQuest ?? ""}`.trim();
			if (!newCurrentQuest) {
				ui.notifications?.warn(t("LITM.Ui.evolution_expand_quest_required"));
				return;
			}

			await applyExpansion({
				actor,
				currentTheme: theme,
				targetTheme,
				newCurrentQuest,
				newName,
				newThemebook,
				newLevel,
				newQuest,
			});

			if (this.messageId) {
				const msg = game.messages?.get(this.messageId);
				await msg?.setFlag("litmv2", "evolutionResolved", true);
			}

			this.close();
			return;
		}

		// The new title tag must differ from the current one (Core Book p.189
		// step 1 for evolve; p.191 for replace creating a new nascent theme).
		if (newName.toLowerCase() === theme.name.toLowerCase()) {
			ui.notifications?.warn(t("LITM.Ui.evolution_title_must_change"));
			return;
		}

		if (mode === "evolve") {
			const sameThemebook = newThemebook === (theme.system?.themebook || "");
			const sameLevel = newLevel === (theme.system?.level || "");
			if (sameThemebook && sameLevel) {
				ui.notifications?.warn(t("LITM.Ui.evolution_must_change"));
				return;
			}
		}

		const keepOldTitleAsPower = !!fd.keepOldTitleAsPower;

		const allRevisable = getRevisableParts(theme);
		let traded;
		if (mode === "replace") {
			// Replace wipes the whole theme — the SPECIFIC tags don't matter
			// for deletion (a separate wipe step handles that). Synthesize a
			// traded-list sized to the rule cap so Promise math is correct.
			const caps = getTradeCaps(allRevisable);
			traded = Array.from(
				{ length: caps.power + caps.weakness + caps.special },
				(_, i) => ({ kind: "synthetic", id: `_${i}` }),
			);
		} else {
			traded = allRevisable.filter(
				(part) => !!fd[`trade-${part.kind}-${part.id}`],
			);
		}

		// Renames only apply on evolve. Skip parts being traded (they're
		// about to be deleted anyway) and only collect actual changes.
		const tradedKeys = new Set(traded.map((p) => `${p.kind}-${p.id}`));
		const renames =
			mode === "evolve"
				? allRevisable
						.filter((p) => !tradedKeys.has(`${p.kind}-${p.id}`))
						.map((p) => {
							const next = `${fd[`rename-${p.kind}-${p.id}`] ?? ""}`.trim();
							return next && next !== p.name ? { ...p, newName: next } : null;
						})
						.filter(Boolean)
				: [];

		await applyTransformation({
			actor,
			theme,
			mode,
			newName,
			newThemebook,
			newLevel,
			newQuest,
			traded,
			renames,
			isFellowship,
			keepOldTitleAsPower,
			oldName: theme.name,
		});

		// Mark the source chat card resolved so its button is hidden on the
		// next render. No-op when opened outside of a chat-card click.
		if (this.messageId) {
			const msg = game.messages?.get(this.messageId);
			await msg?.setFlag("litmv2", "evolutionResolved", true);
		}

		this.close();
	}
}
