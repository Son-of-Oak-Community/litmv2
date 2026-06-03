import { resolveEffect } from "../active-effects/effect-queries.js";
import { StatusTagData } from "../active-effects/status-tag-data.js";
import { getSuccessCost } from "../item/action/action-rules.js";
import { applySuccess } from "../item/action/chat-actions.js";
import { error } from "../logger.js";
import { localize as t } from "../utils.js";

/**
 * Apply a parsed spend intent to an actor, executing all document mutations.
 *
 * @param {Actor} actor         The acting character
 * @param {object} intent       Parsed intent from parseSpendIntent
 * @param {object[]} intent.options  Checked option descriptors
 * @param {number} intent.totalCost  Pre-computed total power cost
 * @param {string|null} intent.messageId  Originating roll message id
 * @param {number} intent.alreadySpent    Power already spent on this message
 * @returns {Promise<{ results: object[], totalSpent: number }>}
 */
export async function applySpendIntent(actor, intent) {
	const { options, messageId, alreadySpent } = intent;
	const results = [];
	let totalSpent = 0;

	// Apply action-success rows first
	for (const opt of options) {
		if (opt.source !== "action") continue;
		const spent = await _applyActionSuccessOption(opt, actor, messageId);
		totalSpent += spent;
		results.push({ source: "action", key: opt.successKey, spent });
	}

	// Apply generic spend options
	for (const opt of options) {
		if (opt.source === "action") continue;

		switch (opt.kind) {
			case "statusPicker": {
				const { power, bodyLines } = await _applyStatusPicker(actor, opt);
				totalSpent += power;
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
				totalSpent += power;
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
				totalSpent += power;
				results.push({ kind: "picker", optionId: opt.optionId, power, names });
				break;
			}
			default: {
				const { power, body } = _applyDefault(opt);
				totalSpent += power;
				results.push({ kind: "default", optionId: opt.optionId, power, body });
				break;
			}
		}
	}

	// Persist spent power on the originating roll message
	if (messageId && totalSpent > 0) {
		const message = game.messages.get(messageId);
		await message?.setFlag("litmv2", "spentPower", alreadySpent + totalSpent);
	}

	return { results, totalSpent };
}

// ---------------------------------------------------------------------------
// Private helpers — one per option kind
// ---------------------------------------------------------------------------

async function _applyActionSuccessOption(opt, actor, messageId) {
	const message = messageId ? game.messages.get(messageId) : null;
	const actionUuid = message?.getFlag("litmv2", "actionUuid");
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
		});
	} catch (err) {
		error("Failed to apply action success:", err);
		ui.notifications.error(t("LITM.Actions.apply_failed"));
		return 0;
	}
	if (!result) return 0;

	await message.setFlag("litmv2", "appliedSuccesses", [
		...appliedNow,
		opt.successKey,
	]);
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

	const c = getSuccessCost(success);
	const variableSpent = (opt.chosenTiers ?? [])
		.filter((n) => Number.isFinite(n))
		.reduce((sum, n) => sum + n, 0);
	return c.fixed + variableSpent;
}

async function _applyStatusPicker(actor, opt) {
	const { reductions, cost } = opt;
	const power = reductions.reduce((sum, { tiers }) => sum + cost * tiers, 0);
	const bodyLines = [];
	for (const { effectId, name, tiers } of reductions) {
		const effect = resolveEffect(effectId, actor);
		if (!effect) continue;
		const oldTier = effect.system.currentTier;
		const newTiers = effect.system.calculateReduction(tiers);
		const newTier = StatusTagData.tierOf(newTiers);
		if (newTier <= 0) {
			await effect.delete();
		} else {
			await effect.update({ "system.tiers": newTiers });
		}
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
			if (hasTier) return `{${escaped}-${Math.max(tier, 1)}}`;
			if (draggable) {
				return isSingleUse ? `{${escaped}:1}` : `{${escaped}}`;
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
