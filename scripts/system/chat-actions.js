import {
	addStoryTagToActor,
	localize as t,
	parseTagStringMatch,
	statusTagEffect,
	storyTagEffect,
} from "../utils.js";
import { pickTargetActor, pickLimit } from "../apps/target-picker.js";
import { getVerbDef, VERB_DEFINITIONS } from "../item/action/verb-definitions.js";

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
 * Apply a single action success to its target. Verb behaviour is keyed off
 * the entry in `VERB_DEFINITIONS`; unknown verbs fall through to the
 * createOrTag path so older serialised data still works.
 *
 * @param {object} args
 * @param {object} args.success    The success entry from action.system.successes
 * @param {Actor} args.actor       The rolling actor (target for self verbs)
 * @returns {Promise<{appliedSummary: string}|null>}
 */
export async function applySuccess({ success, actor }) {
	const def = getVerbDef(success.verb);
	if (def?.kind === "unsupported") {
		ui.notifications.info(t(def.unsupportedMessageKey));
		return null;
	}

	const resolved = await _resolveTarget({ def: def ?? { target: "self" }, success, actor });
	if (!resolved) return null;
	const targetActor = resolved.actor;
	const limitInfo = resolved.limitInfo ?? null;

	// Permission check on the target.
	if (!targetActor?.isOwner && !game.user.isGM) {
		ui.notifications.warn(game.i18n.format("LITM.Actions.apply_no_target_permission", { name: targetActor?.name ?? "" }));
		return null;
	}

	const applier = APPLIERS[def?.kind ?? "createOrTag"] ?? APPLIERS.createOrTag;
	return applier({ def, success, actor: targetActor, limitInfo });
}

/** Bestow / Create / Enhance / Attack / Disrupt / Influence: build a tag or status from payload, attach to actor. */
async function _applyCreateOrTag({ def, success, actor }) {
	const payload = success.payload ?? {};
	const hasTag = !!payload.tagName?.trim();
	const hasStatus = !!payload.statusName?.trim() && payload.tier != null;
	// Payload presence wins when unambiguous; verb default decides only when
	// both or neither are supplied.
	const isStatus = hasTag && !hasStatus
		? false
		: hasStatus && !hasTag
			? true
			: def?.defaultStatus === true;

	if (isStatus) {
		const name = payload.statusName?.trim() || payload.tagName?.trim() || success.label || t("LITM.Terms.status");
		const tier = Math.max(1, Math.min(6, Number(payload.tier) || 1));

		// Stack onto an existing same-named status if present (so attack/influence
		// repeated applies escalate the existing tier rather than spawning duplicates).
		const existing = [...actor.allApplicableEffects()].find(
			(e) => e.type === "status_tag" && e.name.toLowerCase() === name.toLowerCase(),
		);
		if (existing) {
			const newTiers = existing.system.calculateMark(tier);
			await existing.update({ "system.tiers": newTiers });
		} else {
			const tiers = Array.from({ length: 6 }, (_, i) => i + 1 === tier);
			await actor.createEmbeddedDocuments("ActiveEffect", [
				statusTagEffect({ name, tiers, isHidden: false }),
			]);
		}
		return { appliedSummary: game.i18n.format("LITM.Actions.applied_create_status", { actor: actor.name, name, tier }) };
	}

	const name = payload.tagName?.trim() || success.label || t("LITM.Terms.tag");

	// Authored "scratch instead of create": find an existing same-named tag and
	// scratch it. Falls through to creation if no match exists.
	if (payload.scratchTag) {
		const existing = [...actor.allApplicableEffects()].find(
			(e) => SCRATCH_TARGET_TYPES.has(e.type)
				&& e.name.toLowerCase() === name.toLowerCase()
				&& !e.system?.isScratched,
		);
		if (existing) {
			if (typeof existing.system?.toggleScratch === "function") {
				await existing.system.toggleScratch();
			} else {
				await existing.update({ "system.isScratched": true });
			}
			return { appliedSummary: game.i18n.format("LITM.Actions.applied_scratch", { actor: actor.name, name }) };
		}
	}

	await addStoryTagToActor(actor, storyTagEffect({
		name,
		isSingleUse: !!payload.isSingleUse,
	}));
	return { appliedSummary: game.i18n.format("LITM.Actions.applied_create_tag", { actor: actor.name, name }) };
}

// Tag types eligible for "scratch instead of create" — the named, scratchable
// tag families. Excludes relationship_tag because those are pair-specific.
const SCRATCH_TARGET_TYPES = new Set(["story_tag", "power_tag", "fellowship_tag"]);

/** Weaken: remove a beneficial tag/status from the target. */
async function _applyWeaken({ success, actor }) {
	const payload = success.payload ?? {};
	const name = (payload.tagName || payload.statusName || "").trim();
	if (!name) {
		ui.notifications.warn(t("LITM.Actions.apply_weaken_needs_name"));
		return null;
	}
	const lower = name.toLowerCase();

	// Prefer removing a status by name.
	const status = [...actor.allApplicableEffects()].find(
		(e) => e.type === "status_tag" && e.name.toLowerCase() === lower,
	);
	if (status) {
		await status.delete();
		return { appliedSummary: game.i18n.format("LITM.Actions.applied_weaken_status", { actor: actor.name, name }) };
	}

	// Otherwise scratch a same-named tag.
	const tag = [...actor.allApplicableEffects()].find(
		(e) => e.name.toLowerCase() === lower && !e.system?.isScratched,
	);
	if (tag) {
		if (typeof tag.system?.toggleScratch === "function") {
			await tag.system.toggleScratch();
		} else {
			await tag.update({ "system.isScratched": true });
		}
		return { appliedSummary: game.i18n.format("LITM.Actions.applied_weaken_tag", { actor: actor.name, name }) };
	}

	ui.notifications.info(game.i18n.format("LITM.Actions.apply_weaken_no_match", { name, actor: actor.name }));
	return null;
}

/** Advance / Set Back: shift a Limit's value up or down. */
async function _applyProcess({ success, limitInfo }) {
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

	const verb = success.verb;
	const delta = verb === "advance" ? 1 : -1;
	const tier = Math.max(1, Number(success.payload?.tier) || 1);
	const change = delta * tier;

	const result = await actor.system.advanceLimit(limitId, change);
	if (!result) {
		ui.notifications.warn(t("LITM.Actions.apply_process_no_limit"));
		return null;
	}

	const verbKey = verb === "advance" ? "applied_advance" : "applied_setback";
	return {
		appliedSummary: game.i18n.format(`LITM.Actions.${verbKey}`, {
			actor: actor.name,
			name: result.limit.label || t("LITM.Terms.limit"),
			value: result.value,
			max: result.max,
		}),
	};
}

/** Restore: remove a status (by name) or unscratch a tag (by name). */
async function _applyRestore({ success, actor }) {
	const payload = success.payload ?? {};
	const name = (payload.tagName || payload.statusName || "").trim();
	if (!name) {
		ui.notifications.warn(t("LITM.Actions.apply_restore_needs_name"));
		return null;
	}
	const lower = name.toLowerCase();

	// Find a matching status to reduce or remove
	const status = [...actor.allApplicableEffects()].find(
		(e) => e.type === "status_tag" && e.name.toLowerCase() === lower,
	);
	if (status) {
		const current = status.system.tiers ?? [];
		const idx = current.lastIndexOf(true);
		if (idx <= 0) {
			await status.delete();
			return { appliedSummary: game.i18n.format("LITM.Actions.applied_removed", { name }) };
		}
		const newTiers = current.map((v, i) => (i === idx ? false : v));
		await status.update({ "system.tiers": newTiers });
		return { appliedSummary: game.i18n.format("LITM.Actions.applied_reduced", { name, tier: idx }) };
	}

	// Otherwise look for a scratched tag with that name and unscratch it
	const tag = [...actor.allApplicableEffects()].find(
		(e) => e.system?.isScratched && e.name.toLowerCase() === lower,
	);
	if (tag) {
		await tag.update({ "system.isScratched": false });
		return { appliedSummary: game.i18n.format("LITM.Actions.applied_unscratched", { name }) };
	}

	ui.notifications.info(game.i18n.format("LITM.Actions.apply_restore_no_match", { name }));
	return null;
}

/** Discover: post a chat note, no mechanical effect. The outer chat message
 *  prefixes this with the verb, so don't repeat it here. */
function _applyDiscover({ success }) {
	const detail = success.description?.trim() || success.label?.trim() || t("LITM.Actions.discover_default");
	return { appliedSummary: detail };
}

/** Extra feat: applies underlying payload like Bestow/Enhance, just labelled differently. */
async function _applyExtraFeat({ success, actor }) {
	const has = !!(success.payload?.tagName || success.payload?.statusName);
	if (!has) return { appliedSummary: success.label || t("LITM.Actions.verbs.extraFeat") };
	return _applyCreateOrTag({ def: VERB_DEFINITIONS.create, success, actor });
}

/** Dispatch table keyed by verb-definition `kind`. */
const APPLIERS = {
	createOrTag: _applyCreateOrTag,
	weaken: _applyWeaken,
	restore: _applyRestore,
	process: _applyProcess,
	discover: _applyDiscover,
	extraFeat: _applyExtraFeat,
};

/**
 * Apply a free-text consequence (vignette-style: parses [tag] or [status-tier]
 * markup and creates the matching effect on the actor). Used by the GM-side
 * consequence pick UI.
 */
export async function applyConsequence({ text, actor }) {
	if (!actor) return null;
	const re = CONFIG.litmv2.tagStringRe;
	if (!re) return { appliedSummary: text };

	const matches = Array.from(text.matchAll(re));
	if (!matches.length) return { appliedSummary: text };

	const created = [];
	for (const match of matches) {
		const data = parseTagStringMatch(match);
		if (data.type === "status_tag") {
			await actor.createEmbeddedDocuments("ActiveEffect", [
				statusTagEffect({ name: data.name, tiers: data.system.tiers }),
			]);
			const tier = data.system.tiers.lastIndexOf(true) + 1;
			created.push(`[${data.name}-${tier}]`);
		} else {
			await addStoryTagToActor(actor, storyTagEffect({ name: data.name }));
			created.push(`[${data.name}]`);
		}
	}
	return { appliedSummary: created.join(" ") };
}
