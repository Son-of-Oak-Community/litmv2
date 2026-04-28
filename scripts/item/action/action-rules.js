import { getVerbDef } from "./verb-definitions.js";

/**
 * Pure rule logic for the Action Grimoire — what a roll context unlocks,
 * what a success costs, and how a Power budget reduces against applied
 * successes. Imported by chat-hooks (post-roll panel) and roll-dialog
 * (pre-roll preview) so both surfaces show the same answer.
 *
 * Rules sourced from Core Book pp. 146, 151, 154, 158, 159.
 */

/**
 * Success qualities the rules unlock based on roll context.
 *  - Quick rolls resolve narratively; you do NOT spend Power on Effects,
 *    so only narrative-only "quick" successes (and Push-Your-Luck extra
 *    feats) are reachable.
 *  - Detailed (tracked) rolls let you spend Power on Effects; Quick,
 *    Detailed, and ExtraFeat successes are all reachable on a Success or
 *    Success-with-Consequences result.
 *  - Sacrifice and Reaction/Lessen are separate mechanics, not contexts
 *    for applying an action's successes.
 *  - Any roll whose result is "consequences" (failure) unlocks nothing.
 *
 * @param {Roll|null|undefined} roll
 * @returns {Set<string>}
 */
export function getAllowedQualities(roll) {
	const result = roll?.outcome?.label;
	if (!result || result === "consequences") return new Set();
	const type = roll?.litm?.type;
	if (type === "sacrifice" || type === "mitigate") return new Set();
	if (type === "quick") return new Set(["quick", "extraFeat"]);
	if (type === "tracked") return new Set(["quick", "detailed", "extraFeat"]);
	return new Set();
}

/**
 * Power cost of a success:
 *   add/give/recover/scratch a tag = 2 Power
 *   give/reduce a status           = 1 Power per tier
 *   discover a valuable detail     = 1 Power
 *   extra feat                     = 1 Power
 *   process verbs (advance/etc.)   = tier
 * Quick (narrative-only) successes don't spend Power — they're free.
 *
 * @param {object|null|undefined} success
 * @returns {number}
 */
export function getSuccessCost(success) {
	if (!success) return 0;
	if (success.quality === "quick") return 0;
	if (success.quality === "extraFeat") return 1;
	const def = getVerbDef(success.verb);
	const payload = success.payload ?? {};
	const tier = Math.max(1, Number(payload.tier) || 1);
	if (def?.kind === "discover") return 1;
	if (def?.kind === "process" || def?.kind === "unsupported") return tier;
	if (def?.kind === "weaken" && payload.statusName?.trim()) return tier;
	if (payload.statusName?.trim() && !payload.tagName?.trim()) return tier;
	return 2;
}

/**
 * Compute the Power budget for an action panel: total available Power on
 * the roll, total spent across already-applied successes, and the remainder.
 * @param {Roll|null|undefined} roll
 * @param {{successes?: object[]}|null|undefined} actionSystem  An action's `system` object.
 * @param {string[]} appliedKeys  Success ids previously applied on the message.
 * @returns {{ power: number, spent: number, remaining: number }}
 */
export function computePowerBudget(roll, actionSystem, appliedKeys) {
	const power = Number(roll?.power) || 0;
	const successesById = new Map(
		(actionSystem?.successes ?? []).map((o) => [o.id, o]),
	);
	const spent = (appliedKeys ?? [])
		.map((key) => getSuccessCost(successesById.get(key)))
		.reduce((sum, cost) => sum + cost, 0);
	const remaining = Math.max(0, power - spent);
	return { power, spent, remaining };
}
