import { storyTagEffect } from "../../active-effects/effect-factories.js";
import { findApplicableEffect } from "../../active-effects/effect-queries.js";
import { pickLimit, pickTargetActor } from "../../apps/target-picker.js";
import { localize as t } from "../../utils.js";
import { scanMarkup } from "./action-rules.js";
import { parseTagStringMatch } from "./tag-string.js";
import { getVerbDef } from "./verb-definitions.js";

/** Resolve a status token's tier, honoring the player's pick for `[name-]`. */
function resolveTier(token, chosenTiers, variableIndex) {
	if (!token.isVariable) return token.tier;
	const raw = chosenTiers?.[variableIndex];
	return Math.max(1, Math.min(6, Number(raw) || 1));
}

/**
 * Substitute the user-picked tiers into a free-text success/consequence so
 * variable-tier markup like `[shocked-]` renders as `[shocked-3]` in chat.
 * Used by narrative-style appliers (Quick, Discover) that don't materially
 * create the status but still want the picked tier to appear in the prose.
 */
function substituteVariableTiers(text, chosenTiers) {
	if (!text) return text;
	const re = CONFIG.litmv2.tagStringRe;
	if (!re) return text;
	let varIdx = 0;
	return text.replace(re, (match, name, _exclamation, separator, value) => {
		if (separator !== "-" || value) return match;
		const tier = Math.max(1, Math.min(6, Number(chosenTiers?.[varIdx]) || 1));
		varIdx++;
		return `[${name}-${tier}]`;
	});
}

/**
 * Resolve the target actor (or limit) for an success. Returns either an
 * actor reference or `{actor, limitInfo}` for process verbs. Returns `null`
 * if the user cancelled the picker.
 */
async function _resolveTarget({ def, success, actor }) {
	const declaredTarget = success.payload?.target ?? "self";

	if (def.target === "process" || declaredTarget === "process") {
		const limitInfo = await pickLimit();
		if (!limitInfo) return null;
		return { actor: limitInfo.actor, limitInfo };
	}
	if (def.target === "opponent" || declaredTarget === "opponent") {
		const target = await pickTargetActor({ exclude: actor });
		return target ? { actor: target } : null;
	}
	if (declaredTarget === "ally") {
		const target = await pickTargetActor({ allowSelf: true, exclude: null });
		return target ? { actor: target } : null;
	}
	if (declaredTarget === "prompt") {
		const target = await pickTargetActor({ allowSelf: true });
		return target ? { actor: target } : null;
	}
	return { actor };
}

/**
 * Apply a single action success to its target. The success's free-text is
 * parsed for `[name]` / `[name-N]` / `[name-]` / `[name!]` tokens; each token
 * dispatches according to the verb's semantic frame. Multi-token successes
 * apply each token in order and join the summaries.
 *
 * @param {object} args
 * @param {object} args.success            successes[] entry: {id, verb, text}
 * @param {Actor} args.actor               The rolling actor (default target for self verbs)
 * @param {number[]} [args.chosenTiers]    Tiers picked at apply time for `[name-]` variable tokens,
 *                                         in scan order. Unset/undefined falls back to tier 1.
 * @returns {Promise<{appliedSummary: string}|null>}
 */
export async function applySuccess({ success, actor, chosenTiers = [] }) {
	const def = getVerbDef(success.verb);
	if (def?.kind === "unsupported") {
		ui.notifications.info(t(def.unsupportedMessageKey));
		return null;
	}

	const resolved = await _resolveTarget({
		def: def ?? { target: "self" },
		success,
		actor,
	});
	if (!resolved) return null;
	const targetActor = resolved.actor;
	const limitInfo = resolved.limitInfo ?? null;

	if (!targetActor?.isOwner && !game.user.isGM) {
		ui.notifications.warn(
			game.i18n.format("LITM.Actions.apply_no_target_permission", {
				name: targetActor?.name ?? "",
			}),
		);
		return null;
	}

	const applier = APPLIERS[def?.kind ?? "createOrTag"] ?? APPLIERS.createOrTag;
	return applier({
		def,
		success,
		actor: targetActor,
		limitInfo,
		chosenTiers,
	});
}

/**
 * Create/Bestow/Enhance/Attack/Disrupt/Influence — for each markup token,
 * create the named tag or status on the target. Statuses stack via
 * calculateMark when same-named effects already exist.
 */
async function _applyCreateOrTag({ success, actor, chosenTiers }) {
	const tokens = scanMarkup(success.text);
	// No markup → narrative-only Create; emit the prose so the chat card
	// still announces it. Mirrors _applyNarrative / _applyExtraFeat.
	if (!tokens.length) return { appliedSummary: success.text || "" };

	const summaries = [];
	let varIdx = 0;

	for (const tok of tokens) {
		if (tok.type === "tag") {
			await actor.system.addStoryTag(
				storyTagEffect({ name: tok.name, isSingleUse: tok.isSingleUse }),
			);
			summaries.push(
				game.i18n.format("LITM.Actions.applied_create_tag", {
					actor: actor.name,
					name: tok.name,
				}),
			);
			continue;
		}

		const tier = resolveTier(tok, chosenTiers, varIdx);
		if (tok.isVariable) varIdx++;

		await actor.system.addStatus(tok.name, { tier, isHidden: false });
		summaries.push(
			game.i18n.format("LITM.Actions.applied_create_status", {
				actor: actor.name,
				name: tok.name,
				tier,
			}),
		);
	}

	return { appliedSummary: summaries.join(" · ") };
}

/**
 * Weaken — for each token, remove a same-named beneficial effect on the
 * target. Statuses: reduce by the parsed tier (or delete entirely if no
 * tier is specified / tier matches). Tags: scratch the first unscratched
 * same-named tag.
 */
async function _applyWeaken({ success, actor, chosenTiers }) {
	const tokens = scanMarkup(success.text);
	if (!tokens.length) {
		ui.notifications.warn(t("LITM.Actions.apply_weaken_needs_name"));
		return null;
	}

	const summaries = [];
	let varIdx = 0;
	let appliedAny = false;

	for (const tok of tokens) {
		const lower = tok.name.toLowerCase();

		if (tok.type === "status") {
			const tier = resolveTier(tok, chosenTiers, varIdx);
			if (tok.isVariable) varIdx++;

			const summary = await _reduceStatusOnActor(actor, tok.name, tier, {
				notFoundKey: "LITM.Actions.apply_weaken_no_match",
				notFoundArgs: { actor: actor.name },
				removedKey: "LITM.Actions.applied_weaken_status",
				removedArgs: { actor: actor.name },
			});
			if (!summary) continue;
			summaries.push(summary);
			appliedAny = true;
			continue;
		}

		const tag = findApplicableEffect(
			actor,
			(e) =>
				SCRATCH_TARGET_TYPES.has(e.type) &&
				e.name.toLowerCase() === lower &&
				!e.system?.isScratched,
		);
		if (!tag) {
			ui.notifications.info(
				game.i18n.format("LITM.Actions.apply_weaken_no_match", {
					name: tok.name,
					actor: actor.name,
				}),
			);
			continue;
		}
		if (typeof tag.system?.toggleScratch === "function") {
			await tag.system.toggleScratch();
		} else {
			await tag.update({ "system.isScratched": true });
		}
		summaries.push(
			game.i18n.format("LITM.Actions.applied_weaken_tag", {
				actor: actor.name,
				name: tok.name,
			}),
		);
		appliedAny = true;
	}

	if (!appliedAny) return null;
	return { appliedSummary: summaries.join(" · ") };
}

const SCRATCH_TARGET_TYPES = new Set([
	"story_tag",
	"power_tag",
	"fellowship_tag",
]);

function _highestTierIndex(tiers) {
	if (!Array.isArray(tiers)) return -1;
	let idx = -1;
	for (let i = 0; i < tiers.length; i++) if (tiers[i]) idx = i;
	return idx;
}

/**
 * Reduce (or delete) a named status_tag on an actor by the given tier.
 * Used by both _applyWeaken and _applyRestore.
 *
 * @param {Actor} actor
 * @param {string} name              Status name (case-insensitive)
 * @param {number} tier              Amount to reduce by
 * @param {object} opts
 * @param {string} opts.notFoundKey  i18n key for "no match" notification
 * @param {object} [opts.notFoundArgs]  Extra format args merged with {name, actor}
 * @param {string} opts.removedKey   i18n key for "fully removed" summary
 * @param {object} [opts.removedArgs]   Extra format args merged with {name}
 * @param {boolean} [opts.restoreThreshold=false]  When true, use restore
 *   semantics (delete when `tier > highestIdx`, not `tier >= highestIdx + 1`).
 * @returns {Promise<string|null>}  The summary string, or null if not found.
 */
async function _reduceStatusOnActor(
	actor,
	name,
	tier,
	{
		notFoundKey,
		notFoundArgs = {},
		removedKey,
		removedArgs = {},
		restoreThreshold = false,
	} = {},
) {
	const lower = name.toLowerCase();
	const status = findApplicableEffect(
		actor,
		(e) => e.type === "status_tag" && e.name.toLowerCase() === lower,
	);
	if (!status) {
		ui.notifications.info(
			game.i18n.format(notFoundKey, {
				name,
				actor: actor.name,
				...notFoundArgs,
			}),
		);
		return null;
	}
	const current = status.system.tiers ?? [];
	const highestIdx = _highestTierIndex(current);
	const shouldDelete = restoreThreshold
		? highestIdx <= 0 || tier > highestIdx
		: highestIdx < 0 || tier >= highestIdx + 1;
	if (shouldDelete) {
		await status.delete();
		return game.i18n.format(removedKey, {
			name,
			actor: actor.name,
			...removedArgs,
		});
	}
	const newTiers = status.system.calculateReduction(tier);
	await status.update({ "system.tiers": newTiers });
	return game.i18n.format("LITM.Actions.applied_reduced", {
		name,
		tier: highestIdx + 1 - tier,
	});
}

/**
 * Advance / Set Back — shift the picked Limit by the (sum of) parsed tiers.
 * Variable-tier tokens use chosenTiers fallback (default 1).
 */
async function _applyProcess({ success, limitInfo, chosenTiers }) {
	if (!limitInfo) return null;
	const { actor, limitId, source } = limitInfo;

	if (source === "addon") {
		ui.notifications.warn(t("LITM.Actions.apply_process_addon_limit"));
		return null;
	}
	if (typeof actor.system?.advanceLimit !== "function") {
		ui.notifications.warn(t("LITM.Actions.apply_process_no_limit"));
		return null;
	}

	const tokens = scanMarkup(success.text);
	let tier = 1;
	let varIdx = 0;
	if (tokens.length) {
		tier = 0;
		for (const tok of tokens) {
			if (tok.type !== "status") continue;
			tier += resolveTier(tok, chosenTiers, varIdx);
			if (tok.isVariable) varIdx++;
		}
		tier = Math.max(1, tier);
	}

	const delta = success.verb === "advance" ? 1 : -1;
	const result = await actor.system.advanceLimit(limitId, delta * tier);
	if (!result) {
		ui.notifications.warn(t("LITM.Actions.apply_process_no_limit"));
		return null;
	}

	const verbKey =
		success.verb === "advance" ? "applied_advance" : "applied_setback";
	return {
		appliedSummary: game.i18n.format(`LITM.Actions.${verbKey}`, {
			actor: actor.name,
			name: result.limit.label || t("LITM.Terms.limit"),
			value: result.value,
			max: result.max,
		}),
	};
}

/**
 * Restore / Lessen — for each token, reduce a same-named status by the
 * parsed tier (deleting it if the reduction takes it past tier 1) or
 * unscratch a same-named tag.
 */
async function _applyRestore({ success, actor, chosenTiers }) {
	const tokens = scanMarkup(success.text);
	if (!tokens.length) {
		ui.notifications.warn(t("LITM.Actions.apply_restore_needs_name"));
		return null;
	}

	const summaries = [];
	let varIdx = 0;
	let appliedAny = false;

	for (const tok of tokens) {
		const lower = tok.name.toLowerCase();

		if (tok.type === "status") {
			const tier = resolveTier(tok, chosenTiers, varIdx);
			if (tok.isVariable) varIdx++;

			const summary = await _reduceStatusOnActor(actor, tok.name, tier, {
				notFoundKey: "LITM.Actions.apply_restore_no_match",
				removedKey: "LITM.Actions.applied_removed",
				restoreThreshold: true,
			});
			if (!summary) continue;
			summaries.push(summary);
			appliedAny = true;
			continue;
		}

		const tag = findApplicableEffect(
			actor,
			(e) =>
				SCRATCH_TARGET_TYPES.has(e.type) &&
				e.system?.isScratched &&
				e.name.toLowerCase() === lower,
		);
		if (!tag) {
			ui.notifications.info(
				game.i18n.format("LITM.Actions.apply_restore_no_match", {
					name: tok.name,
				}),
			);
			continue;
		}
		if (typeof tag.system?.toggleScratch === "function") {
			await tag.system.toggleScratch();
		} else {
			await tag.update({ "system.isScratched": false });
		}
		summaries.push(
			game.i18n.format("LITM.Actions.applied_unscratched", { name: tok.name }),
		);
		appliedAny = true;
	}

	if (!appliedAny) return null;
	return { appliedSummary: summaries.join(" · ") };
}

/** Discover: post a chat note, no mechanical effect. */
function _applyDiscover({ success, chosenTiers }) {
	const text = substituteVariableTiers(success.text?.trim(), chosenTiers);
	return { appliedSummary: text || t("LITM.Actions.discover_default") };
}

/** Extra feat (legacy verb-success): apply text markup as Create-style. */
async function _applyExtraFeat({ success, actor, chosenTiers }) {
	const tokens = scanMarkup(success.text);
	if (!tokens.length) {
		return {
			appliedSummary: success.text || t("LITM.Actions.verbs.extraFeat"),
		};
	}
	return _applyCreateOrTag({ success, actor, chosenTiers });
}

/** Narrative-only verbs (Quick): no mechanical change, just emit the prose. */
function _applyNarrative({ success, chosenTiers }) {
	return {
		appliedSummary: substituteVariableTiers(success.text || "", chosenTiers),
	};
}

/** Dispatch table keyed by verb-definition `kind`. */
const APPLIERS = {
	createOrTag: _applyCreateOrTag,
	weaken: _applyWeaken,
	restore: _applyRestore,
	process: _applyProcess,
	discover: _applyDiscover,
	extraFeat: _applyExtraFeat,
	narrative: _applyNarrative,
};

/**
 * Apply a free-text consequence (vignette-style: parses [tag] or [status-tier]
 * markup and creates the matching effect on the actor). Used by the GM-side
 * consequence pick UI.
 */
export async function applyConsequence({ text, actor, chosenTiers = [] }) {
	if (!actor) return null;
	const re = CONFIG.litmv2.tagStringRe;
	if (!re) return { appliedSummary: text };

	const matches = Array.from(text.matchAll(re));
	if (!matches.length) return { appliedSummary: text };

	const created = [];
	let varIdx = 0;
	for (const match of matches) {
		const data = parseTagStringMatch(match);
		if (data.type === "status_tag") {
			const parsedTier = data.system.tiers.lastIndexOf(true) + 1;
			const isVariable = parsedTier === 0;
			const tier = isVariable
				? Math.max(1, Math.min(6, Number(chosenTiers?.[varIdx]) || 1))
				: parsedTier;
			if (isVariable) varIdx++;
			await actor.system.addStatus(data.name, { tier });
			created.push(`[${data.name}-${tier}]`);
		} else {
			await actor.system.addStoryTag(storyTagEffect({ name: data.name }));
			created.push(`[${data.name}]`);
		}
	}
	return { appliedSummary: created.join(" ") };
}
