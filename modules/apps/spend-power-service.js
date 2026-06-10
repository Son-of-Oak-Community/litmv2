import { resolveEffect } from "../active-effects/effect-queries.js";
import { StatusTagData } from "../active-effects/status-tag-data.js";
import {
	computeSuccessSpend,
	getSuccessCost,
} from "../item/action/action-rules.js";
import { applySuccess } from "../item/action/chat-actions.js";
import { error } from "../logger.js";
import { FLAGS } from "../system/config.js";
import { localize as t } from "../utils.js";

/**
 * Apply a parsed spend intent to an actor, executing all document mutations.
 *
 * @param {Actor} actor         The acting character
 * @param {object} intent       Parsed intent from parseSpendIntent
 * @param {object[]} intent.options  Checked option descriptors
 * @param {number} intent.totalCost  Pre-computed total power cost
 * @param {string|null} intent.messageId  Originating roll message id
 * @param {number} intent.alreadySpent    Generic Power already spent on this
 *   message (the spentPower flag; applied action successes are tracked
 *   separately in appliedSuccessCosts)
 * @param {string|null} [intent.targetActorId]  Actor picked on the dialog's
 *   target chip row; pre-resolves the target for actor-targeted successes.
 * @returns {Promise<{ results: object[], totalSpent: number }>}
 */
export async function applySpendIntent(actor, intent) {
	const { options, messageId, alreadySpent, targetActorId } = intent;
	const presetTarget = targetActorId ? game.actors.get(targetActorId) : null;
	const results = [];
	let actionSpent = 0;
	let genericSpent = 0;

	// Apply action-success rows first
	for (const opt of options) {
		if (opt.source !== "action") continue;
		const spent = await _applyActionSuccessOption(
			opt,
			actor,
			messageId,
			presetTarget,
		);
		actionSpent += spent;
		results.push({ source: "action", key: opt.successKey, spent });
	}

	// Apply generic spend options
	for (const opt of options) {
		if (opt.source === "action") continue;

		switch (opt.kind) {
			case "statusPicker": {
				const { power, bodyLines } = await _applyStatusPicker(actor, opt);
				genericSpent += power;
				results.push({
					kind: "statusPicker",
					optionId: opt.optionId,
					power,
					bodyLines,
				});
				break;
			}
			case "counter": {
				const { power } = _applyCounter(opt);
				genericSpent += power;
				results.push({
					kind: "counter",
					optionId: opt.optionId,
					power,
					count: opt.count,
				});
				break;
			}
			case "picker": {
				const { power, names } = await _applyPicker(actor, opt);
				genericSpent += power;
				results.push({ kind: "picker", optionId: opt.optionId, power, names });
				break;
			}
			default: {
				const { power, body } = _applyDefault(opt);
				genericSpent += power;
				results.push({ kind: "default", optionId: opt.optionId, power, body });
				break;
			}
		}
	}

	// Persist generic spends on the originating roll message. Action-success
	// costs are deliberately not added: they are already tracked per-success
	// in the appliedSuccessCosts flag, and the Spend Power budget subtracts
	// both flags — folding them into spentPower too would double-count.
	if (messageId && genericSpent > 0) {
		const message = game.messages.get(messageId);
		await message?.setFlag("litmv2", "spentPower", alreadySpent + genericSpent);
	}

	return { results, totalSpent: actionSpent + genericSpent };
}

// ---------------------------------------------------------------------------
// Private helpers — one per option kind
// ---------------------------------------------------------------------------

async function _applyActionSuccessOption(opt, actor, messageId, presetTarget) {
	const message = messageId ? game.messages.get(messageId) : null;
	const actionUuid = message?.getFlag("litmv2", FLAGS.actionUuid);
	if (!actionUuid) return 0;
	const action = await foundry.utils.fromUuid(actionUuid);
	if (!action || action.type !== "action") return 0;

	const success = (action.system.successes ?? []).find(
		(o) => o.id === opt.successKey,
	);
	if (!success) return 0;

	// Skip if already applied since the dialog last opened (race-safe)
	const appliedNow = message.getFlag("litmv2", "appliedSuccesses") ?? [];
	if (appliedNow.includes(opt.successKey)) return 0;

	let result;
	try {
		result = await applySuccess({
			success,
			actor,
			chosenTiers: opt.chosenTiers,
			chosenTags: opt.chosenTags ?? null,
			presetTarget,
		});
	} catch (err) {
		error("Failed to apply action success:", err);
		ui.notifications.error(t("LITM.Actions.apply_failed"));
		return 0;
	}
	if (!result) return 0;

	// Actual cost paid: the non-tag fixed part, plus only the tags the player
	// kept selected, plus the tiers they picked for variable statuses.
	const spent = computeSuccessSpend(getSuccessCost(success), {
		chosenTags: opt.chosenTags,
		chosenTiers: opt.chosenTiers,
	});

	// Persist what was actually paid so reopened dialogs and the power budget
	// don't have to guess tier/tag choices from the action definition. One
	// update for both flags — they must stay in sync.
	const appliedCosts = message.getFlag("litmv2", "appliedSuccessCosts") ?? {};
	await message.update({
		"flags.litmv2.appliedSuccesses": [...appliedNow, opt.successKey],
		"flags.litmv2.appliedSuccessCosts": {
			...appliedCosts,
			[opt.successKey]: spent,
		},
	});
	await foundry.documents.ChatMessage.create({
		speaker: foundry.documents.ChatMessage.getSpeaker({ actor }),
		content: await foundry.applications.handlebars.renderTemplate(
			"systems/litmv2/templates/chat/action-applied.html",
			{
				actorImg: actor.img,
				actorName: actor.name,
				label: t(`LITM.Actions.verbs.${success.verb}`),
				summary: _stripActorPrefix(result.appliedSummary, actor.name),
				footer: action.name,
			},
		),
	});

	return spent;
}

async function _applyStatusPicker(actor, opt) {
	const { reductions, cost } = opt;
	const power = reductions.reduce((sum, { tiers }) => sum + cost * tiers, 0);
	const bodyLines = [];
	for (const { effectId, name, tiers } of reductions) {
		const effect = resolveEffect(effectId, actor);
		if (!effect) continue;
		const oldTier = effect.system.currentTier;
		const newTier = StatusTagData.tierOf(
			effect.system.calculateReduction(tiers),
		);
		await effect.system.reduceTier(tiers, { deleteOnEmpty: true });
		const after =
			newTier > 0
				? `<strong>${name}-${newTier}</strong>`
				: `<em>${t("LITM.Ui.removed")}</em>`;
		bodyLines.push(`<span>${name}-${oldTier} &rarr; ${after}</span>`);
	}
	return { power, bodyLines };
}

function _applyCounter(opt) {
	return { power: opt.cost * opt.count };
}

async function _applyPicker(actor, opt) {
	const { chips, cost } = opt;
	const power = cost * chips.length;
	const names = [];
	for (const { tagId, tagName } of chips) {
		names.push(tagName);
		const effect = resolveEffect(tagId, actor);
		if (effect) await effect.update({ "system.isScratched": false });
	}
	return { power, names };
}

function _applyDefault(opt) {
	const { entries, cost, hasTier, draggable } = opt;

	let body = "";
	if (entries.length > 0) {
		const tags = entries.map(({ name, tier, isSingleUse }) => {
			const escaped = foundry.utils.escapeHTML(name);
			if (hasTier) return `[${escaped}-${Math.max(tier, 1)}]`;
			if (draggable) {
				return isSingleUse ? `[${escaped}!]` : `[${escaped}]`;
			}
			return `<em>${escaped}</em>`;
		});
		body = tags.join(" ");
	}

	let power;
	if (entries.length === 0) {
		power = cost;
	} else if (hasTier) {
		power = entries.reduce(
			(sum, { tier }) => sum + cost * Math.max(tier, 1),
			0,
		);
	} else {
		power = entries.reduce(
			(sum, { isSingleUse }) => sum + (isSingleUse ? 1 : cost),
			0,
		);
	}

	return { power, body };
}

/**
 * Strip a leading "ActorName: " or "ActorName → / ← " prefix from an applied
 * summary. Re-exported so spend-power.js can share the same helper without
 * duplicating it.
 */
function _stripActorPrefix(summary, actorName) {
	if (!summary || !actorName) return summary;
	const prefixes = [`${actorName}: `, `${actorName} → `, `${actorName} ← `];
	for (const p of prefixes) {
		if (summary.startsWith(p)) return summary.slice(p.length);
	}
	return summary;
}

export { _stripActorPrefix as stripActorPrefix };
