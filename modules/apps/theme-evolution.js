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
	fireTrackCompletion,
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
	syntheticTradedFromCaps,
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
		// When the rule cap for this kind is zero (player is at baseline,
		// nothing to trade), hide the +1 toggle entirely so the row reads as
		// rename-only. Showing an unclickable pill misleads players into
		// thinking the cap calculation is broken when it isn't.
		const toggleEl = cb.closest(".litm-theme-evolution__trade-toggle");
		if (caps[kind] === 0) {
			if (toggleEl) toggleEl.hidden = true;
			cb.disabled = true;
			cb.checked = false;
			row.classList.remove("is-trade-cap");
			continue;
		}
		if (toggleEl) toggleEl.hidden = false;
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
	await applyTransformation({
		actor,
		theme: targetTheme,
		mode: "replace",
		newName,
		newThemebook,
		newLevel,
		newQuest,
		traded: syntheticTradedFromCaps(targetCaps),
		renames: [],
		isFellowship: false,
		keepOldTitleAsPower: false,
		oldName: targetTheme.name,
	});
}

/**
 * Apply evolve-mode updates to surviving (non-traded) power/weakness tag
 * effects: the player's revised names, and — when the themebook changes
 * — a reset of each tag's `system.question` index, since the kept tags'
 * answers belong to questions that no longer exist on the new themebook.
 * The tag name (the player's authored answer) is preserved; only the
 * question pointer is cleared, so the player can re-pick a question on
 * the new themebook in the theme sheet.
 */
async function applyEvolveKeptTagUpdates(
	theme,
	{ renames, traded, themebookChanged },
) {
	const tradedEffectIds = new Set(
		traded
			.filter((p) => p.kind === "power" || p.kind === "weakness")
			.map((p) => p.id),
	);
	const renameByEffectId = new Map(
		renames
			.filter((r) => r.kind === "power" || r.kind === "weakness")
			.map((r) => [r.id, r.newName]),
	);

	const updates = [];
	for (const eff of theme.effects) {
		const isPower = POWER_TAG_TYPES.has(eff.type) && !eff.system?.isTitleTag;
		const isWeakness = eff.type === "weakness_tag";
		if (!isPower && !isWeakness) continue;
		if (tradedEffectIds.has(eff.id)) continue;
		const update = { _id: eff.id };
		if (renameByEffectId.has(eff.id)) {
			update.name = renameByEffectId.get(eff.id);
		}
		if (themebookChanged && eff.system?.question != null) {
			update["system.question"] = null;
		}
		if (Object.keys(update).length > 1) updates.push(update);
	}
	if (updates.length) {
		await theme.updateEmbeddedDocuments("ActiveEffect", updates);
	}
}

/**
 * Delete every non-title power tag and every weakness tag from the theme.
 * Used in Replace mode where the whole theme is wiped.
 */
async function wipeNonTitleTagEffects(theme) {
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
	// The surviving title tag still carries the OLD themebook's question
	// index — reset it so the new theme starts with a clean slot. The
	// title tag's name is updated by the item-hooks rename-sync; only its
	// question pointer needs zeroing.
	const titleTag = [...theme.effects].find(
		(e) => POWER_TAG_TYPES.has(e.type) && e.system?.isTitleTag,
	);
	if (titleTag && titleTag.system?.question != null) {
		await theme.updateEmbeddedDocuments("ActiveEffect", [
			{ _id: titleTag.id, "system.question": null },
		]);
	}
}

/**
 * Build the theme `update()` payload for the new shape — name, themebook,
 * level, quest text, and reset tracks. On Evolve, preserved specials are
 * carried forward with renames applied and traded entries dropped. On
 * Replace, specials are cleared, the Improve track resets, and the
 * nascent-theme counter starts at 2 (Core Book p.192).
 */
function buildThemeUpdate({
	mode,
	theme,
	newName,
	newThemebook,
	newLevel,
	newQuest,
	traded,
	renames,
}) {
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
		update["system.specialImprovements"] = (
			theme.system?.specialImprovements ?? []
		)
			.map((si, idx) =>
				specialRenames.has(idx) ? { ...si, name: specialRenames.get(idx) } : si,
			)
			.filter((_, idx) => !tradedSpecialIdx.has(idx));
	} else {
		update["system.specialImprovements"] = [];
		update["system.nascentImprovements"] = 2;
		// A replaced theme is a wholly new nascent theme, so its Improve
		// track starts fresh. Evolution preserves the track since the
		// theme is the same one continuing in a new direction.
		update["system.improve.value"] = 0;
	}
	return update;
}

/**
 * Seed a freshly-replaced (nascent) theme with the required starting
 * effects: one weakness tag, and — under Inexorable Failure (Core Book
 * p.190) — optionally the discarded theme's title preserved as a regular
 * power tag.
 */
async function seedReplacementTheme(theme, { keepOldTitleAsPower, oldName }) {
	const toCreate = [
		weaknessTagEffect({
			name: t("LITM.Ui.evolution_new_weakness_placeholder"),
			isActive: true,
		}),
	];
	if (keepOldTitleAsPower && oldName) {
		toCreate.push(powerTagEffect({ name: oldName, isActive: true }));
	}
	await theme.createEmbeddedDocuments("ActiveEffect", toCreate);
}

/**
 * Apply Promise gain to the hero, banking overflow in `pendingPromise`
 * if the gain would exceed the schema cap. Fires `litm.trackCompleted`
 * when the track crosses to 5; emits a chat card when overflow banks
 * onto an already-full track (no crossing, but the player needs to know).
 * Fellowship themes never reach this — the caller short-circuits.
 */
async function applyPromiseToActor(actor, promiseGained) {
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
		fireTrackCompletion("system.promise", newPromise, actor, actor);
	} else if (banked > 0) {
		// The track was already at the cap when this Promise arrived,
		// so detectTrackCompletion correctly returns null (no crossing).
		// Surface a lightweight chat card so the player isn't left to
		// notice the +N indicator on their sheet on their own.
		await emitPromiseBankedChat(actor, banked);
	}
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
	// Fellowship themes never mark Promise (Core Book p.193).
	const promiseGained = isFellowship ? 0 : 1 + traded.length;

	if (mode === "evolve") {
		const themebookChanged =
			(newThemebook ?? "") !== (theme.system?.themebook ?? "");
		await applyEvolveKeptTagUpdates(theme, {
			renames,
			traded,
			themebookChanged,
		});
	}

	// Delete traded power/weakness effects; Replace then wipes the rest
	// (everything but the title tag) so the new nascent theme starts clean.
	const tradedEffectIds = traded
		.filter((p) => p.kind === "power" || p.kind === "weakness")
		.map((p) => p.id);
	if (tradedEffectIds.length) {
		await theme.deleteEmbeddedDocuments("ActiveEffect", tradedEffectIds);
	}
	if (mode === "replace") {
		await wipeNonTitleTagEffects(theme);
	}

	// Apply the theme shape update. Title-tag auto-sync (item-hooks.js)
	// runs off the `name` change.
	const update = buildThemeUpdate({
		mode,
		theme,
		newName,
		newThemebook,
		newLevel,
		newQuest,
		traded,
		renames,
	});
	await theme.update(update);

	if (mode === "replace") {
		await seedReplacementTheme(theme, { keepOldTitleAsPower, oldName });
	}

	// Mark Promise on the hero. Per Core Book p.193, reaching 5 triggers
	// a Moment of Fulfillment; once resolved, the track resets and "any
	// remaining promise" is marked as usual. The schema caps `promise`
	// at 5 — we bank overflow in `pendingPromise`, and the hero sheet's
	// MoF-entry handler picks it up when the player resolves.
	if (promiseGained > 0) {
		await applyPromiseToActor(actor, promiseGained);
	}

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

/**
 * Group themebooks by Might tier (origin/adventure/greatness/variable)
 * for the new-theme dropdown. Books with an unrecognized tier fall into
 * an "Other" bucket at the end so they aren't silently dropped.
 */
function buildThemebookGroups(themebooks) {
	const tierOrder = [...getThemeLevels(), "variable"];
	const buckets = new Map(tierOrder.map((k) => [k, []]));
	const ungrouped = [];
	for (const tb of themebooks) {
		const bucket = buckets.get(tb.themeLevel);
		if (bucket) bucket.push(tb);
		else ungrouped.push(tb);
	}
	const sortByLabel = (a, b) => a.label.localeCompare(b.label);
	const groups = tierOrder
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
		groups.push({
			tier: "",
			label: t("LITM.Ui.evolution_themebook_other"),
			options: ungrouped
				.sort(sortByLabel)
				.map((tb) => ({ value: tb.name, label: tb.label })),
		});
	}
	return groups;
}

/**
 * Build the Expand-mode context: the hero's other replaceable themes
 * and, for each, the count of extras the rules would trade in. The
 * recompute step reads `expandTargetExtras` keyed by target id so the
 * live preview matches what `applyExpansion` will actually apply.
 */
function buildExpandContext(actor, currentThemeId) {
	const otherThemes = actor.items
		.filter(
			(i) =>
				i.type === "theme" &&
				i.id !== currentThemeId &&
				!i.system?.isFellowship,
		)
		.map((th) => ({ id: th.id, name: th.name }));
	const expandTargetExtras = Object.fromEntries(
		otherThemes.map((ot) => {
			const target = actor.items.get(ot.id);
			return [
				ot.id,
				target ? totalTradeCap(getTradeCaps(getRevisableParts(target))) : 0,
			];
		}),
	);
	return { otherThemes, expandTargetExtras };
}

/**
 * Resolve the traded-parts and renames lists from form data for the
 * non-expand modes. Replace synthesizes a placeholder list sized to the
 * rule cap (specific tags don't matter — a separate wipe step handles
 * deletion); Evolve reads explicit per-tag checkbox state.
 */
function resolveTradedAndRenames({ mode, fd, allRevisable }) {
	let traded;
	if (mode === "replace") {
		traded = syntheticTradedFromCaps(getTradeCaps(allRevisable));
	} else {
		traded = allRevisable.filter(
			(part) => !!fd[`trade-${part.kind}-${part.id}`],
		);
	}

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

	return { traded, renames };
}

/**
 * Mark the originating chat message as resolved so its open-wizard
 * footer button is hidden on the next render. No-op when the wizard
 * was opened outside of a chat click, or when the current user is
 * neither the author nor a GM (Foundry blocks setFlag in that case;
 * the chat-hook hides the button for non-authors anyway).
 */
async function markSourceMessageResolved(messageId) {
	if (!messageId) return;
	const msg = game.messages?.get(messageId);
	if (!msg) return;
	if (!msg.isAuthor && !game.user.isGM) return;
	await msg.setFlag("litmv2", "evolutionResolved", true);
}

/**
 * Handle the Expand submit path: validate target theme + rewritten
 * quest, then apply. Returns true if the submit was handled (success
 * or validation failure), false to fall through to evolve/replace.
 */
async function submitExpand({
	actor,
	theme,
	fd,
	newName,
	newThemebook,
	newLevel,
	newQuest,
	messageId,
	close,
}) {
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
	await markSourceMessageResolved(messageId);
	close();
	targetTheme.sheet?.render(true, { focus: true });
}

/**
 * Replace the current theme with a full copy of a dropped theme item.
 * Wipes the current theme's non-title power/weakness tags, then copies
 * shape (name, themebook, level, quest, description, specials) and tags
 * from the source. Promise math follows the Core Book Replace rule:
 * +1 base plus +1 per extra power/weakness/special on the source.
 */
async function applyDroppedTheme({ actor, theme, dropped }) {
	const isFellowship = !!theme.system?.isFellowship;
	if (!isFellowship && dropped.system?.isFellowship) {
		ui.notifications?.warn(t("LITM.Ui.evolution_drop_theme_kind_mismatch"));
		return;
	}
	if (isFellowship && !dropped.system?.isFellowship) {
		ui.notifications?.warn(t("LITM.Ui.evolution_drop_theme_kind_mismatch"));
		return;
	}

	await wipeNonTitleTagEffects(theme);

	await theme.update({
		name: dropped.name,
		"system.themebook": dropped.system?.themebook ?? "",
		"system.level": dropped.system?.level || getDefaultThemeLevel(),
		"system.description": dropped.system?.description ?? "",
		"system.quest.description": dropped.system?.quest?.description ?? "",
		"system.quest.tracks.milestone.value": 0,
		"system.quest.tracks.abandon.value": 0,
		"system.improve.value": 0,
		"system.nascentImprovements": 2,
		"system.specialImprovements": foundry.utils.deepClone(
			dropped.system?.specialImprovements ?? [],
		),
	});

	// Copy power/weakness tag effects from the source. Title tag stays
	// on the current theme (it auto-renames to the new theme's name via
	// the item-hooks rename sync); only revisable tags are duplicated.
	const toCreate = [];
	for (const eff of dropped.effects) {
		const isPower = POWER_TAG_TYPES.has(eff.type) && !eff.system?.isTitleTag;
		const isWeakness = eff.type === "weakness_tag";
		if (!isPower && !isWeakness) continue;
		const obj = eff.toObject();
		delete obj._id;
		toCreate.push(obj);
	}
	if (toCreate.length) {
		await theme.createEmbeddedDocuments("ActiveEffect", toCreate);
	}

	if (!isFellowship) {
		const sourceCaps = getTradeCaps(getRevisableParts(dropped));
		const promiseGained = 1 + totalTradeCap(sourceCaps);
		await applyPromiseToActor(actor, promiseGained);
	}
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
			setLevel: ThemeEvolutionWizard.#onSetLevel,
		},
	};

	static PARTS = {
		form: {
			template: "systems/litmv2/templates/apps/theme-evolution.html",
			scrollable: [""],
		},
	};

	#dragDrop = null;

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

	get _dragDrop() {
		this.#dragDrop ??= new foundry.applications.ux.DragDrop.implementation({
			dropSelector: ".litm-theme-evolution__new-theme",
			permissions: { drop: () => true },
			callbacks: { drop: this.#onDropTheme.bind(this) },
		});
		return this.#dragDrop;
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
			const all = await queryItemsFromPacks({
				type: "themebook",
				indexFields: ["name", "system.theme_level", "system.isFellowship"],
				map: (entry) => ({
					name: entry.name,
					label: entry.name,
					themeLevel: entry.system?.theme_level ?? "",
					isFellowship: !!entry.system?.isFellowship,
				}),
			});
			// Fellowship themes can only evolve into other fellowship themebooks
			// and vice versa — mixing kinds breaks the actor's invariant
			// (heroes hold non-fellowship themes; the fellowship singleton
			// holds fellowship themes).
			const wantFellowship = !!theme.system?.isFellowship;
			this._themebooks = all.filter((tb) => tb.isFellowship === wantFellowship);
		}

		const themebookGroups = buildThemebookGroups(this._themebooks);
		const levels = getThemeLevels().map((key) => ({
			value: key,
			label: t(`LITM.Terms.${key}`) || key,
		}));
		const themebookLevels = Object.fromEntries(
			this._themebooks.map((tb) => [tb.name, tb.themeLevel ?? ""]),
		);

		const isFellowship = !!theme.system.isFellowship;
		const { defaultMode, milestoneFull, abandonFull } = availableModes(theme);
		const showModeSelect = milestoneFull && abandonFull;
		const revisable = getRevisableParts(theme);
		const tradeCaps = getTradeCaps(revisable);
		const totalCap = totalTradeCap(tradeCaps);

		// Expand (Core Book p.190) is an alternative to Evolve: keep this
		// theme largely as-is and instead replace one of the hero's OTHER
		// themes. Only offered when this theme is eligible to evolve
		// (Milestone full) and the hero has another non-fellowship theme.
		const { otherThemes, expandTargetExtras } = buildExpandContext(
			actor,
			this.themeId,
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
			themebookLevels,
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
			// Re-read the live actor on every refresh so the Promise preview
			// reflects external mutations (camping advancement, GM edits,
			// peer-driven track completions) while the wizard is open.
			const live = game.actors.get(this.actorId)?.system?.promise;
			const ctx =
				typeof live === "number"
					? { ...context, currentPromise: live }
					: context;
			applyModeVisibility(html, ctx);
			enforceTradeCaps(html, ctx);
			recomputePromiseSummary(html, ctx);
		};
		for (const input of html.querySelectorAll(
			"input[name='mode'], input[name^='trade-'], select[name='expandTarget']",
		)) {
			input.addEventListener("change", refresh);
		}

		// When the player picks a themebook with a fixed tier, default the
		// might selection to that tier. They can still override afterwards.
		const themebookSelect = html.querySelector("select[name='themebook']");
		if (themebookSelect && context?.themebookLevels) {
			themebookSelect.addEventListener("change", (ev) => {
				const level = context.themebookLevels[ev.target.value];
				if (!level || level === "variable") return;
				applyLevelSelection(html, level);
			});
		}

		refresh();

		this._dragDrop.bind(html);
	}

	/**
	 * Drop handler for the "new theme" fieldset. Replaces the current theme
	 * with a full copy of the dropped theme — name, themebook, level, quest,
	 * description, specials, and all power/weakness tag effects — in a
	 * single confirmed action. Equivalent to a Replace transformation that
	 * seeds from a curated source instead of placeholders. The wizard
	 * closes on success.
	 */
	async #onDropTheme(event) {
		const data =
			foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
		if (!data?.uuid || data?.type !== "Item") return;
		const item = await foundry.utils.fromUuid(data.uuid);
		if (!item || item.type !== "theme") {
			ui.notifications?.warn(t("LITM.Ui.evolution_drop_theme_invalid"));
			return;
		}
		const actor = getActor(this);
		const theme = getTheme(this);
		if (!actor || !theme) return;
		if (this._submitting) return;

		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: { title: t("LITM.Ui.evolution_drop_theme_confirm_title") },
			content: `<p>${game.i18n.format("LITM.Ui.evolution_drop_theme_confirm_body", { current: theme.name, dropped: item.name })}</p>`,
		});
		if (!confirmed) return;

		this._submitting = true;
		try {
			await applyDroppedTheme({ actor, theme, dropped: item });
			await markSourceMessageResolved(this.messageId);
			this.close();
			theme.sheet?.render(true, { focus: true });
		} finally {
			this._submitting = false;
		}
	}

	static async #onCancel(_event, _target) {
		this.close();
	}

	static #onSetLevel(_event, target) {
		const level = target?.dataset?.level;
		if (!level) return;
		applyLevelSelection(this.element, level);
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

		if (mode === "expand") {
			return submitExpand({
				actor,
				theme,
				fd,
				newName,
				newThemebook,
				newLevel,
				newQuest,
				messageId: this.messageId,
				close: () => this.close(),
			});
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
		const { traded, renames } = resolveTradedAndRenames({
			mode,
			fd,
			allRevisable,
		});

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
		await markSourceMessageResolved(this.messageId);
		this.close();
		theme.sheet?.render(true, { focus: true });
	}
}

/**
 * Apply a level selection to the picker: toggle .is-active on each
 * segmented label and check the matching radio so FormDataExtended sees
 * the new value. Used by both the click handler and the themebook
 * auto-select.
 */
function applyLevelSelection(html, level) {
	if (!html) return;
	const labels = html.querySelectorAll("[data-action='setLevel']");
	for (const label of labels) {
		label.classList.toggle("is-active", label.dataset.level === level);
	}
	const radios = html.querySelectorAll("input[type='radio'][name='level']");
	for (const radio of radios) {
		radio.checked = radio.value === level;
	}
}
