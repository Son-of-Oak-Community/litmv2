import { resolveEffect } from "../active-effects/effect-queries.js";
import { clampTier, StatusTagData } from "../active-effects/status-tag-data.js";
import {
	computeSuccessSpend,
	getSuccessCost,
	unionAppliedSuccessKeys,
} from "../item/action/action-rules.js";
import { applySuccess } from "../item/action/chat-actions.js";
import { error, warn } from "../logger.js";
import { FLAGS } from "../system/config.js";
import { Sockets } from "../system/sockets.js";
import { getStoryTagSidebar, localize as t } from "../utils.js";

/**
 * An inflicted status tier, held to 1..the world's track depth. The Spend
 * Power dialog caps it client-side, but the service writes (and bills) it, and
 * the GM relay receives it off the socket, so neither can trust that.
 */
function _inflictTier(tier) {
	return clampTier(tier, { min: 1 });
}

/**
 * Apply a parsed spend intent to an actor, executing all document mutations.
 *
 * @param {Actor} actor         The acting character
 * @param {object} intent       Parsed intent from parseSpendIntent
 * @param {object[]} intent.options  Checked option descriptors
 * @param {number} intent.totalCost  Pre-computed total power cost
 * @param {string|null} intent.messageId  Originating roll message id
 * @param {number} intent.alreadySpent    Generic Power already spent on this
 *   message when the dialog opened (the spentPower flag; applied action
 *   successes are tracked separately in appliedSuccessCosts). Informational:
 *   the flag is re-read before it is written.
 * @param {string|null} [intent.targetActorId]  Actor picked on the dialog's
 *   target chip row; pre-resolves the target for actor-targeted successes.
 * @returns {Promise<{ results: object[], totalSpent: number }>}
 */
export async function applySpendIntent(actor, intent) {
	const { options, messageId, targetActorId } = intent;
	const presetTarget = targetActorId ? game.actors.get(targetActorId) : null;
	const results = [];
	let actionSpent = 0;
	let genericSpent = 0;
	// Bills Power the moment a write lands, not when its option returns: an
	// option with several entries that rejects midway still owes for the
	// entries that went through (see the `finally` below).
	const charge = (power) => {
		genericSpent += power;
	};

	try {
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
					const { power, bodyLines } = await _applyStatusPicker(
						actor,
						opt,
						messageId,
						charge,
					);
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
					charge(power);
					results.push({
						kind: "counter",
						optionId: opt.optionId,
						power,
						count: opt.count,
					});
					break;
				}
				case "picker": {
					const { power, tags } = await _applyPicker(actor, opt, charge);
					results.push({ kind: "picker", optionId: opt.optionId, power, tags });
					break;
				}
				case "scratchPicker": {
					const { power, tags } = await _applyScratchPicker(opt, charge);
					results.push({
						kind: "scratchPicker",
						optionId: opt.optionId,
						power,
						tags,
					});
					break;
				}
				default: {
					// Inflict with a picked target applies the statuses directly
					// (or via the GM relay); without one it stays the legacy
					// draggable-chat-chip flow handled by _applyDefault.
					let applied;
					if (
						opt.optionId === "inflict_status" &&
						opt.targetActorId &&
						opt.entries?.length
					) {
						applied = await _applyInflict(opt, messageId, charge);
					} else {
						applied = _applyDefault(opt);
						charge(applied.power);
					}
					results.push({
						kind: "default",
						optionId: opt.optionId,
						power: applied.power,
						body: applied.body,
					});
					break;
				}
			}
		}
	} finally {
		// Persist generic spends on the originating roll message — in `finally`
		// so a later write rejecting still records the Power of those that
		// already landed (genericSpent only grows after a write applies, one
		// entry at a time); otherwise a resubmit would apply them again for
		// free. Action-success costs are deliberately not added: they are
		// already tracked per-success in the appliedSuccessCosts flag, and the
		// Spend Power budget subtracts both flags — folding them into
		// spentPower too would double-count.
		if (messageId && genericSpent > 0) {
			// Read the flag now, not the `alreadySpent` the dialog captured when it
			// opened: a second Spend Power window on the same roll may have
			// written since, and adding to the stale figure would overwrite it.
			const message = game.messages.get(messageId);
			const spentNow = message?.getFlag("litmv2", "spentPower") ?? 0;
			await message?.setFlag("litmv2", "spentPower", spentNow + genericSpent);
		}
	}

	return { results, totalSpent: actionSpent + genericSpent };
}

// ---------------------------------------------------------------------------
// Private helpers — one per option kind
// ---------------------------------------------------------------------------

async function _applyActionSuccessOption(opt, actor, messageId, presetTarget) {
	const { spent } = await applyActionSuccess({
		actor,
		messageId,
		successKey: opt.successKey,
		chosenTiers: opt.chosenTiers,
		chosenTags: opt.chosenTags ?? null,
		presetTarget,
	});
	return spent;
}

/**
 * Apply one action success end-to-end: resolve the success from its roll
 * message, honor the applied-race guard, run the applier, persist the
 * appliedSuccesses / appliedSuccessCosts flags and post the "action applied"
 * chat card. Shared by the local Spend Power path above and the GM-side
 * applySuccessAsGM socket relay (which passes presetTarget / presetLimitInfo
 * pre-resolved and reacts to the returned status).
 *
 * A relayed apply ("the GM will finish this") records no flags, posts no
 * chat card and charges 0 — the GM's client does all three so the result is
 * indistinguishable from a local apply.
 *
 * @returns {Promise<{spent: number,
 *   status: "applied"|"relayed"|"already"|"nothing"|"invalid"}>}
 */
export async function applyActionSuccess({
	actor,
	messageId,
	successKey,
	chosenTiers = [],
	chosenTags = null,
	presetTarget = null,
	presetLimitInfo = null,
}) {
	const message = messageId ? game.messages.get(messageId) : null;
	const actionUuid = message?.getFlag("litmv2", FLAGS.actionUuid);
	if (!actionUuid) return { spent: 0, status: "invalid" };
	const action = await foundry.utils.fromUuid(actionUuid);
	if (!action || action.type !== "action")
		return { spent: 0, status: "invalid" };

	const success = (action.system.successes ?? []).find(
		(o) => o.id === successKey,
	);
	if (!success) return { spent: 0, status: "invalid" };

	// Skip if already applied since the dialog last opened (race-safe; the GM
	// relay handler runs the same check against a possible double-submit).
	// The union heals an appliedSuccesses array clobbered by a concurrent
	// writer — appliedSuccessCosts is the merge-safe canonical record.
	const appliedNow = unionAppliedSuccessKeys(
		message.getFlag("litmv2", "appliedSuccesses"),
		message.getFlag("litmv2", "appliedSuccessCosts"),
	);
	if (appliedNow.includes(successKey)) return { spent: 0, status: "already" };

	let result;
	try {
		result = await applySuccess({
			success,
			actor,
			chosenTiers,
			chosenTags,
			presetTarget,
			presetLimitInfo,
			relay: { messageId, successKey },
		});
	} catch (err) {
		error("Failed to apply action success:", err);
		ui.notifications.error(t("LITM.Actions.apply_failed"));
		return { spent: 0, status: "invalid" };
	}
	if (result?.relayed) return { spent: 0, status: "relayed" };
	if (!result) return { spent: 0, status: "nothing" };

	// Actual cost paid: the non-tag fixed part, plus only the tags the player
	// kept selected, plus the tiers they picked for variable statuses.
	const spent = computeSuccessSpend(getSuccessCost(success), {
		chosenTags,
		chosenTiers,
	});

	// Persist what was actually paid so reopened dialogs and the power budget
	// don't have to guess tier/tag choices from the action definition. One
	// update for both flags — they must stay in sync. The cost is written as
	// a per-key dot path (object flags merge, so concurrent writers can't
	// erase each other's cost); the array is display/back-compat and readers
	// union it with the costs record.
	await message.update({
		"flags.litmv2.appliedSuccesses": [...appliedNow, successKey],
		[`flags.litmv2.appliedSuccessCosts.${successKey}`]: spent,
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

	return { spent, status: "applied" };
}

/**
 * GM-side entry for the applySuccessAsGM socket relay. Re-resolves the ids
 * in the payload to documents, runs the shared apply pipeline, and whispers
 * the acting player when nothing landed — a silent no-op on the GM client is
 * indistinguishable from a bug at the player's table. Runs on the active
 * GM's client only; the socket listener gates on activeGM before calling.
 *
 * Relays for the same roll message are serialized: one Spend Power
 * submission can fire several relays back-to-back, and interleaving their
 * async apply pipelines on the GM client would race the shared message
 * flags and target mutations — the local path applies its options
 * sequentially, so the relayed path must too.
 *
 * Bails silently when any id no longer resolves (actor deleted, message
 * pruned between dispatch and receipt).
 *
 * @param {object} payload  See the applySuccessAsGM dispatch in chat-actions.js.
 */
export function handleApplySuccessAsGM(payload) {
	return _enqueueRelay(payload, "applySuccessAsGM", () =>
		_handleApplySuccessAsGM(payload),
	);
}

/**
 * GM-side entry for the applyStatusAsGM socket relay: generic Spend Power
 * status ops (Inflict's add, Reduce's tier drop) on actors the player doesn't
 * own. Shares the per-message relay queue with the success relay so one
 * submission mixing successes and status ops stays serialized.
 */
export function handleApplyStatusAsGM(payload) {
	return _enqueueRelay(payload, "applyStatusAsGM", () =>
		_handleApplyStatusAsGM(payload),
	);
}

/** Pending relay chain per roll message id — see handleApplySuccessAsGM. */
const relayQueue = new Map();

/** Serialize a relayed apply behind any pending ones for the same message. */
function _enqueueRelay(payload, label, fn) {
	const key = payload?.messageId ?? "";
	const prev = relayQueue.get(key) ?? Promise.resolve();
	const run = prev
		.then(fn)
		.catch((err) => error(`${label} relay failed:`, err));
	relayQueue.set(key, run);
	run.finally(() => {
		if (relayQueue.get(key) === run) relayQueue.delete(key);
	});
	return run;
}

async function _handleApplyStatusAsGM({
	userId,
	op,
	actorId,
	effectId,
	name,
	tier,
	tiers,
}) {
	const actor = game.actors.get(actorId);
	// A vanished target/effect between dispatch and receipt would be a silent
	// no-op on the GM client — whisper the acting player instead (mirrors the
	// "nothing" branch of the success relay).
	if (!actor) return _whisperRelayNothing(userId, null);

	if (op === "add") {
		await actor.system.addStatus(name, {
			tier: _inflictTier(tier),
			isHidden: false,
		});
		return;
	}
	if (op === "reduce") {
		const effect = resolveEffect(effectId, actor);
		if (!effect) return _whisperRelayNothing(userId, actor);
		await effect.system.reduceTier(tiers, { deleteOnEmpty: true });
	}
}

async function _whisperRelayNothing(userId, target) {
	await foundry.documents.ChatMessage.create({
		content: game.i18n.format("LITM.Actions.apply_relay_nothing", {
			name: target?.system?.publicName ?? target?.name ?? "",
		}),
		whisper: [userId],
	});
}

async function _handleApplySuccessAsGM({
	userId,
	actorId,
	messageId,
	successKey,
	targetActorId,
	limitInfo,
	chosenTiers,
	chosenTags,
}) {
	const actor = game.actors.get(actorId);
	if (!actor) return;
	const presetTarget = targetActorId ? game.actors.get(targetActorId) : null;
	// A vanished target must bail like a vanished limit actor below —
	// falling through with a null presetTarget would reopen the target
	// picker on the GM's client for opponent verbs.
	if (targetActorId && !presetTarget) return;
	let presetLimitInfo = null;
	if (limitInfo) {
		const limitActor = game.actors.get(limitInfo.actorId);
		if (!limitActor) return;
		presetLimitInfo = {
			actor: limitActor,
			limitId: limitInfo.limitId,
			source: limitInfo.source,
		};
	}

	const { status } = await applyActionSuccess({
		actor,
		messageId,
		successKey,
		chosenTiers: chosenTiers ?? [],
		chosenTags: chosenTags ?? null,
		presetTarget,
		presetLimitInfo,
	});

	// "already" (race-guard double-submit) stays silent: the first apply
	// already produced the card the player is looking at.
	if (status !== "nothing") return;
	await _whisperRelayNothing(
		userId,
		presetTarget ?? presetLimitInfo?.actor ?? actor,
	);
}

/**
 * Reduce the selected statuses. Each reduction carries its owner id (the
 * picker groups statuses by story-tag-sidebar actor), so a status can be
 * reduced on a target as well as on the rolling actor. Reductions on actors
 * the player can't write route through the applyStatusAsGM relay; like the
 * scene-tag scratch fork, a drop with no active GM is skipped and not billed.
 */
async function _applyStatusPicker(actor, opt, messageId, charge) {
	const { reductions, cost } = opt;
	const bodyLines = [];
	let paidTiers = 0;
	for (const { effectId, name, actorId, tiers } of reductions) {
		const owner = (actorId ? game.actors.get(actorId) : null) ?? actor;
		const effect = resolveEffect(effectId, owner);
		if (!effect) {
			warn(`Status reduction skipped — "${name}" could not be resolved.`);
			continue;
		}
		// Observer permission suffices to read the effect, so old/new tiers are
		// computed locally even when the write itself is relayed to the GM.
		const oldTier = effect.system.currentTier;
		const newTier = StatusTagData.tierOf(
			effect.system.calculateReduction(tiers),
		);
		if (owner.isOwner || game.user.isGM) {
			await effect.system.reduceTier(tiers, { deleteOnEmpty: true });
		} else if (game.users.activeGM) {
			Sockets.dispatch("applyStatusAsGM", {
				op: "reduce",
				userId: game.user.id,
				messageId,
				actorId: owner.id,
				effectId: effect.id,
				tiers,
			});
		} else {
			warn(`Status reduction dropped — no active GM to apply "${name}".`);
			continue;
		}
		charge(cost * tiers);
		paidTiers += tiers;
		// Status and actor names are player-set and this body is rendered raw
		// ({{{body}}} in chat/spend-power.html) to every client — escape both,
		// as the sibling _applyDefault path already does.
		const esc = foundry.utils.escapeHTML;
		const safeName = esc(name);
		const label =
			owner === actor
				? safeName
				: `${esc(owner.system?.publicName ?? owner.name)}: ${safeName}`;
		const after =
			newTier > 0
				? `<strong>${safeName}-${newTier}</strong>`
				: `<em>${t("LITM.Ui.removed")}</em>`;
		bodyLines.push(`<span>${label}-${oldTier} &rarr; ${after}</span>`);
	}
	return { power: cost * paidTiers, bodyLines };
}

/**
 * Inflict the entered statuses on the target picked in the dialog (the
 * no-target case never reaches here — it posts a draggable chat chip via
 * _applyDefault). Unowned targets route through the applyStatusAsGM relay.
 */
async function _applyInflict(opt, messageId, charge) {
	const { entries, cost, targetActorId } = opt;
	const target = game.actors.get(targetActorId);
	if (!target) {
		warn("Inflict skipped — target actor not found.");
		return { power: 0, body: "" };
	}
	const canApply = target.isOwner || game.user.isGM;
	if (!canApply && !game.users.activeGM) {
		warn(
			`Inflict dropped — no active GM to apply statuses to "${target.name}".`,
		);
		return { power: 0, body: "" };
	}

	const chips = [];
	let power = 0;
	for (const { name, tier } of entries) {
		const tierN = _inflictTier(tier);
		if (canApply) {
			await target.system.addStatus(name, { tier: tierN, isHidden: false });
		} else {
			Sockets.dispatch("applyStatusAsGM", {
				op: "add",
				userId: game.user.id,
				messageId,
				actorId: target.id,
				name,
				tier: tierN,
			});
		}
		charge(cost * tierN);
		chips.push(`[${foundry.utils.escapeHTML(name)}-${tierN}]`);
		power += cost * tierN;
	}
	const targetName = foundry.utils.escapeHTML(
		target.system?.publicName ?? target.name,
	);
	return { power, body: `<strong>${targetName}</strong> ${chips.join(" ")}` };
}

function _applyCounter(opt) {
	return { power: opt.cost * opt.count };
}

/**
 * Recover (un-scratch) the selected tags. The list comes from
 * `HeroData#scratchedTags`, which spans the Fellowship as well as the hero, so
 * resolution looks there too. The Fellowship is usually GM-owned: a write the
 * player can't make goes through the active GM, same as `_applyScratchPicker`.
 * Charged per recovery that lands — an unresolved tag, or one with no GM to
 * write it, is skipped and not billed.
 */
async function _applyPicker(actor, opt, charge) {
	const { chips, cost } = opt;
	const tags = [];
	let recovered = 0;
	for (const { tagId, tagName } of chips) {
		const effect = resolveEffect(tagId, actor, { fellowship: true });
		if (!effect) {
			warn(`Recover skipped — tag "${tagName}" could not be resolved.`);
			continue;
		}
		if (effect.isOwner || game.user.isGM) {
			await effect.update({ "system.isScratched": false });
		} else if (game.users.activeGM) {
			Sockets.dispatch("recoverEffect", { uuid: effect.uuid });
		} else {
			warn(`Recover dropped — no active GM to apply "${tagName}".`);
			continue;
		}
		recovered++;
		charge(cost);
		// Recovered tags render as live (un-scratched) chips of their real type.
		tags.push({ name: tagName, type: effect.type, isScratched: false });
	}
	return { power: cost * recovered, tags };
}

/**
 * Scratch (cross off) the selected story/backpack tags. Unlike `_applyPicker`
 * (which recovers tags on the rolling actor), each chip carries its own owner
 * id, so a tag can be scratched on a target as well as on the actor. Scene
 * (world-pack) story tags carry no actor owner (`isScene`) and route through
 * the story-tag write fork instead.
 */
async function _applyScratchPicker(opt, charge) {
	const { chips, cost } = opt;
	const tags = [];
	// Charge only for scratches that actually land. A chip whose owner/effect
	// vanished, or a scene write that can't be routed (no sidebar / no active
	// GM), is skipped and not billed — Power is scarce, so a silent drop must
	// not cost the player anything or show a false "scratched" chip.
	let scratched = 0;

	// Actor-owned story/backpack tags: scratch directly on their owner. Scene
	// tags carry no actor effect (handled via the fork below).
	for (const { tagId, tagName, actorId, isScene } of chips) {
		if (isScene) continue;
		const owner = actorId ? game.actors.get(actorId) : null;
		const effect = owner ? resolveEffect(tagId, owner) : null;
		if (!effect) {
			warn(`Scratch skipped — tag "${tagName}" could not be resolved.`);
			continue;
		}
		if (owner.isOwner || game.user.isGM) {
			await effect.update({ "system.isScratched": true });
		} else if (game.users.activeGM) {
			// Players can't write an unowned owner's effect — the active GM
			// applies the scratch (same relay the roll flow uses for ally tags).
			Sockets.dispatch("scratchEffect", { uuid: effect.uuid });
		} else {
			warn(`Scratch dropped — no active GM to apply "${tagName}".`);
			continue;
		}
		tags.push({ name: tagName, type: effect.type, isScratched: true });
		scratched++;
		charge(cost);
	}

	// Scene story tags live in the world pack, which players can't write
	// directly. Route through the same fork the sidebar uses (#storyTagOp):
	// the GM writes the pack via the sidebar's doUpdate; a player broadcasts
	// the request for the active GM to apply (see the storyTagsUpdate socket).
	const sceneChips = chips.filter((c) => c.isScene);
	if (sceneChips.length) {
		const updates = sceneChips.map((c) => ({
			_id: c.tagId,
			"system.isScratched": true,
		}));
		let applied = false;
		if (game.user.isGM) {
			// Guard the GM path: a null sidebar would otherwise drop the write
			// silently. Post-ready it's always present.
			const sidebar = getStoryTagSidebar();
			if (sidebar) {
				await sidebar.doUpdate("updateTags", updates);
				applied = true;
			} else {
				warn("Scene story-tag scratch dropped — Tags sidebar unavailable.");
			}
		} else if (game.users.activeGM) {
			// Only dispatch when a GM is online to apply it (see the activeGM
			// gate in the storyTagsUpdate handler); otherwise it's a silent drop.
			Sockets.dispatch("storyTagsUpdate", {
				operation: "updateTags",
				data: updates,
			});
			applied = true;
		} else {
			warn("Scene story-tag scratch dropped — no active GM to apply it.");
		}
		if (applied) {
			for (const c of sceneChips) {
				tags.push({ name: c.tagName, type: "story_tag", isScratched: true });
			}
			scratched += sceneChips.length;
			charge(cost * sceneChips.length);
		}
	}

	return { power: cost * scratched, tags };
}

function _applyDefault(opt) {
	const { entries, cost, hasTier, draggable } = opt;

	let body = "";
	if (entries.length > 0) {
		const tags = entries.map(({ name, tier, isSingleUse }) => {
			const escaped = foundry.utils.escapeHTML(name);
			if (hasTier) return `[${escaped}-${_inflictTier(tier)}]`;
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
			(sum, { tier }) => sum + cost * _inflictTier(tier),
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
