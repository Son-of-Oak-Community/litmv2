import { storyTagEffect } from "../../active-effects/effect-factories.js";
import { findApplicableEffect } from "../../active-effects/effect-queries.js";
import {
	clampTier,
	maxStatusTier,
	StatusTagData,
} from "../../active-effects/status-tag-data.js";
import { pickLimit, pickTargetActor } from "../../apps/target-picker.js";
import { Sockets } from "../../system/sockets.js";
import { localize as t } from "../../utils.js";
import { scanMarkup } from "./action-rules.js";
import { classifyTagStringMatch } from "./tag-string.js";
import { getVerbDef, successTargetMode } from "./verb-definitions.js";

/**
 * Target name for chat summaries and notifications. Challenges concealed
 * via `system.concealName` resolve to their public alias so stored chat
 * text never reveals the real name — even when the GM generates it.
 * @param {Actor} actor
 * @returns {string}
 */
const publicName = (actor) => actor.system?.publicName ?? actor.name;

/**
 * Resolve a status token's tier, honoring the player's pick for `[name-]`.
 * Returns 0 for a variable token whose `chosenTiers` slot is missing or zero,
 * which the appliers interpret as "skip this token" — supports successes that
 * list many alternative statuses (eg. an Action Grimoire Attack rote with
 * eight harmful statuses, where the player applies one or two of them).
 */
function resolveTier(token, chosenTiers, variableIndex) {
	if (!token.isVariable) return token.tier;
	return clampTier(chosenTiers?.[variableIndex]);
}

/**
 * Substitute the user-picked tiers into a free-text success/consequence so
 * variable-tier markup like `[shocked-]` renders as `[shocked-3]` in chat.
 * Used by narrative-style appliers (Quick, Discover) that don't materially
 * create the status but still want the picked tier to appear in the prose.
 * A skipped token (chosenTiers slot 0 or missing) keeps its literal
 * `[name-]` form so the prose doesn't lie about an unpicked tier.
 */
function substituteVariableTiers(text, chosenTiers) {
	if (!text) return text;
	const re = CONFIG.litmv2.tagStringRe;
	if (!re) return text;
	let varIdx = 0;
	return text.replace(re, (...args) => {
		const c = classifyTagStringMatch(args);
		if (c.kind !== "status" || c.value) return args[0];
		const raw = Number(chosenTiers?.[varIdx]);
		varIdx++;
		if (!Number.isFinite(raw) || raw <= 0) return args[0];
		const tier = Math.min(maxStatusTier(), raw);
		return `[${c.name}-${tier}]`;
	});
}

/**
 * Resolve the target actor (or limit) for an success. Returns either an
 * actor reference or `{actor, limitInfo}` for process verbs. Returns `null`
 * if the user cancelled the picker.
 *
 * `presetTarget` is the actor picked on the Spend Power dialog's target
 * chip row — when set, actor-targeted successes use it directly instead of
 * prompting. Process verbs always prompt: limits aren't actors.
 */
async function _resolveTarget({
	def,
	actor,
	presetTarget = null,
	presetLimitInfo = null,
}) {
	switch (successTargetMode(def)) {
		case "process": {
			// GM-side relay re-apply: the player already picked the limit.
			if (presetLimitInfo)
				return { actor: presetLimitInfo.actor, limitInfo: presetLimitInfo };
			const limitInfo = await pickLimit();
			if (!limitInfo) return null;
			return { actor: limitInfo.actor, limitInfo };
		}
		case "opponent": {
			if (presetTarget && presetTarget !== actor)
				return { actor: presetTarget };
			const target = await pickTargetActor({ exclude: actor });
			return target ? { actor: target } : null;
		}
		case "ally": {
			if (presetTarget) return { actor: presetTarget };
			const target = await pickTargetActor({ allowSelf: true, exclude: null });
			return target ? { actor: target } : null;
		}
		default:
			return { actor };
	}
}

/**
 * A tag token is applied unless the player explicitly deselected its chip in
 * Spend Power. `chosenTags` is a sparse boolean array in tag-scan order;
 * absent (null/undefined) means "apply everything" — the path taken by
 * single-tag successes and the GM consequence menu.
 */
function isTagChosen(chosenTags, tagIdx) {
	return !chosenTags || chosenTags[tagIdx] !== false;
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
 * @param {boolean[]|null} [args.chosenTags]  Tag picks for successes listing several `[tag]`
 *                                         tokens, in scan order. Null applies all tags.
 * @param {Actor|null} [args.presetTarget] Target picked in the Spend Power dialog; skips
 *                                         the post-submit target picker when set.
 * @param {object|null} [args.presetLimitInfo]  Pre-resolved {actor, limitId, source} for
 *                                         process verbs; skips the limit picker. Set by the
 *                                         GM-side applySuccessAsGM relay handler.
 * @param {object|null} [args.relay]       {messageId, successKey} context from Spend Power.
 *                                         When the permission guard fails and a GM is active,
 *                                         the apply is dispatched to the GM instead of warned
 *                                         away, and `{relayed: true}` is returned.
 * @returns {Promise<{appliedSummary: string}|{relayed: true}|null>}
 */
export async function applySuccess({
	success,
	actor,
	chosenTiers = [],
	chosenTags = null,
	presetTarget = null,
	presetLimitInfo = null,
	relay = null,
}) {
	const def = getVerbDef(success.verb);
	if (def?.kind === "unsupported") {
		ui.notifications.info(t(def.unsupportedMessageKey));
		return null;
	}

	const resolved = await _resolveTarget({
		def: def ?? { target: "self" },
		actor,
		presetTarget,
		presetLimitInfo,
	});
	if (!resolved) return null;
	const targetActor = resolved.actor;
	const limitInfo = resolved.limitInfo ?? null;

	if (!targetActor?.isOwner && !game.user.isGM) {
		// The roll that earned this success already passed GM moderation, so
		// the active GM applies it on the player's behalf — same trust model
		// as the scratchEffect / storyTagsUpdate relays. Without a GM online
		// nothing can apply it, so keep the warn-and-bail.
		if (relay && game.users.activeGM) {
			Sockets.dispatch("applySuccessAsGM", {
				userId: game.user.id,
				actorId: actor.id,
				messageId: relay.messageId,
				successKey: relay.successKey,
				targetActorId: targetActor?.id ?? null,
				limitInfo: limitInfo
					? {
							actorId: limitInfo.actor.id,
							limitId: limitInfo.limitId,
							source: limitInfo.source,
						}
					: null,
				chosenTiers,
				chosenTags,
			});
			return { relayed: true };
		}
		ui.notifications.warn(
			game.i18n.format("LITM.Actions.apply_no_target_permission", {
				name: targetActor ? publicName(targetActor) : "",
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
		chosenTags,
	});
}

/**
 * Create/Bestow/Enhance/Attack/Disrupt/Influence — for each markup token,
 * create the named tag or status on the target. Statuses stack via
 * calculateMark when same-named effects already exist.
 */
async function _applyCreateOrTag({ success, actor, chosenTiers, chosenTags }) {
	const tokens = scanMarkup(success.text);
	// No markup → narrative-only Create; emit the prose so the chat card
	// still announces it. Mirrors _applyNarrative / _applyExtraFeat.
	if (!tokens.length) return { appliedSummary: success.text || "" };

	const summaries = [];
	let varIdx = 0;
	let tagIdx = 0;

	for (const tok of tokens) {
		if (tok.type === "tag") {
			const chosen = isTagChosen(chosenTags, tagIdx);
			tagIdx++;
			if (!chosen) continue;
			await actor.system.addStoryTag(
				storyTagEffect({ name: tok.name, isSingleUse: tok.isSingleUse }),
			);
			summaries.push(
				game.i18n.format("LITM.Actions.applied_create_tag", {
					actor: publicName(actor),
					name: tok.name,
				}),
			);
			continue;
		}

		const tier = resolveTier(tok, chosenTiers, varIdx);
		if (tok.isVariable) varIdx++;
		if (tier <= 0) continue;

		await actor.system.addStatus(tok.name, { tier, isHidden: false });
		summaries.push(
			game.i18n.format("LITM.Actions.applied_create_status", {
				actor: publicName(actor),
				name: tok.name,
				tier,
			}),
		);
	}

	if (!summaries.length) return null;
	return { appliedSummary: summaries.join(" · ") };
}

/**
 * Shared applier for the two mirrored scratch verbs:
 * - **Weaken** scratches the first unscratched same-named tag, or reduces a
 *   same-named status by the parsed tier.
 * - **Restore / Lessen** unscratches a scratched same-named tag, or reduces a
 *   status with restore-threshold delete semantics.
 * The direction config keeps the two verbs structurally identical.
 */
const SCRATCH_VERB_CONFIGS = {
	weaken: {
		targetScratched: true,
		restoreThreshold: false,
		needsNameKey: "LITM.Actions.apply_weaken_needs_name",
		noMatchKey: "LITM.Actions.apply_weaken_no_match",
		statusRemovedKey: "LITM.Actions.applied_weaken_status",
		tagSummaryKey: "LITM.Actions.applied_weaken_tag",
	},
	restore: {
		targetScratched: false,
		restoreThreshold: true,
		needsNameKey: "LITM.Actions.apply_restore_needs_name",
		noMatchKey: "LITM.Actions.apply_restore_no_match",
		statusRemovedKey: "LITM.Actions.applied_removed",
		tagSummaryKey: "LITM.Actions.applied_unscratched",
	},
};

async function _applyScratchToggle(
	{ success, actor, chosenTiers, chosenTags },
	{
		targetScratched,
		restoreThreshold,
		needsNameKey,
		noMatchKey,
		statusRemovedKey,
		tagSummaryKey,
	},
) {
	const tokens = scanMarkup(success.text);
	if (!tokens.length) {
		ui.notifications.warn(t(needsNameKey));
		return null;
	}

	const summaries = [];
	let varIdx = 0;
	let tagIdx = 0;
	let appliedAny = false;

	for (const tok of tokens) {
		const lower = tok.name.toLowerCase();

		if (tok.type === "status") {
			const tier = resolveTier(tok, chosenTiers, varIdx);
			if (tok.isVariable) varIdx++;

			const summary = await _reduceStatusOnActor(actor, tok.name, tier, {
				notFoundKey: noMatchKey,
				removedKey: statusRemovedKey,
				restoreThreshold,
			});
			if (!summary) continue;
			summaries.push(summary);
			appliedAny = true;
			continue;
		}

		const chosen = isTagChosen(chosenTags, tagIdx);
		tagIdx++;
		if (!chosen) continue;

		const tag = findApplicableEffect(
			actor,
			(e) =>
				SCRATCH_TARGET_TYPES.has(e.type) &&
				e.name.toLowerCase() === lower &&
				!!e.system?.isScratched !== targetScratched,
		);
		if (!tag) {
			ui.notifications.info(
				game.i18n.format(noMatchKey, {
					name: tok.name,
					actor: publicName(actor),
				}),
			);
			continue;
		}
		await tag.system.setScratched(targetScratched);
		summaries.push(
			game.i18n.format(tagSummaryKey, {
				actor: publicName(actor),
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

/**
 * Reduce (or delete) a named status_tag on an actor by the given tier.
 * Used by both _applyWeaken and _applyRestore.
 *
 * @param {Actor} actor
 * @param {string} name              Status name (case-insensitive)
 * @param {number} tier              Amount to reduce by
 * @param {object} opts
 * @param {string} opts.notFoundKey  i18n key for "no match" notification
 * @param {string} opts.removedKey   i18n key for "fully removed" summary
 * @param {boolean} [opts.restoreThreshold=false]  When true, use restore
 *   semantics (delete when `tier > highestIdx`, not `tier >= highestIdx + 1`).
 * @returns {Promise<string|null>}  The summary string, or null if not found.
 */
async function _reduceStatusOnActor(
	actor,
	name,
	tier,
	{ notFoundKey, removedKey, restoreThreshold = false } = {},
) {
	const lower = name.toLowerCase();
	const status = findApplicableEffect(
		actor,
		(e) => e.type === "status_tag" && e.name.toLowerCase() === lower,
	);
	if (!status) {
		ui.notifications.info(
			game.i18n.format(notFoundKey, { name, actor: publicName(actor) }),
		);
		return null;
	}
	const current = status.system.tiers ?? [];
	const highestIdx = StatusTagData.tierOf(current) - 1;
	const shouldDelete = restoreThreshold
		? highestIdx <= 0 || tier > highestIdx
		: highestIdx < 0 || tier >= highestIdx + 1;
	if (shouldDelete) {
		await status.delete();
		return game.i18n.format(removedKey, {
			name,
			actor: publicName(actor),
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
 * Variable-tier tokens resolve via chosenTiers (default 0 = skip). The
 * final shift is floored at 1 so a process success always advances the
 * limit, even when every variable token was skipped.
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
			actor: publicName(actor),
			name: result.limit.label || t("LITM.Terms.limit"),
			value: result.value,
			max: result.max,
		}),
	};
}

/** Discover: post a chat note, no mechanical effect. */
function _applyDiscover({ success, chosenTiers }) {
	const text = substituteVariableTiers(success.text?.trim(), chosenTiers);
	return { appliedSummary: text || t("LITM.Actions.discover_default") };
}

/** Extra feat (legacy verb-success): apply text markup as Create-style. */
async function _applyExtraFeat({ success, actor, chosenTiers, chosenTags }) {
	const tokens = scanMarkup(success.text);
	if (!tokens.length) {
		return {
			appliedSummary: success.text || t("LITM.Actions.verbs.extraFeat"),
		};
	}
	return _applyCreateOrTag({ success, actor, chosenTiers, chosenTags });
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
	weaken: (args) => _applyScratchToggle(args, SCRATCH_VERB_CONFIGS.weaken),
	restore: (args) => _applyScratchToggle(args, SCRATCH_VERB_CONFIGS.restore),
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
	if (!re) return { appliedSummary: text, applied: [] };

	const matches = Array.from(text.matchAll(re));
	if (!matches.length) return { appliedSummary: text, applied: [] };

	const created = [];
	const applied = [];
	let varIdx = 0;
	for (const match of matches) {
		const c = classifyTagStringMatch(match);
		if (c.kind === "status") {
			const isVariable = c.tier === 0;
			const tier = isVariable ? clampTier(chosenTiers?.[varIdx]) : c.tier;
			if (isVariable) varIdx++;
			if (tier <= 0) continue;
			await actor.system.addStatus(c.name, { tier, isHidden: false });
			created.push(`[${c.name}-${tier}]`);
			applied.push({ kind: "status", name: c.name, tier });
		} else if (c.kind === "story") {
			await actor.system.addStoryTag(
				storyTagEffect({ name: c.name, isSingleUse: c.isSingleUse }),
			);
			created.push(c.isSingleUse ? `[${c.name}!]` : `[${c.name}]`);
			applied.push({ kind: "story", name: c.name });
		}
	}
	if (!created.length) return null;
	return { appliedSummary: created.join(" "), applied };
}
