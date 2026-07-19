import { classifyTagString } from "./tag-string.js";
import { getVerbDef } from "./verb-definitions.js";

/**
 * Scan free-text for `[name]` / `[name-N]` / `[name-]` / `[name!]` markup
 * and return a uniform token shape easier for the cost calculator and the
 * appliers to consume than the raw classifyTagString shape.
 *
 *   {type: "tag", name, isSingleUse}
 *   {type: "status", name, tier, isVariable}  // tier=0 when isVariable=true
 *
 * @param {string} text
 * @returns {Array<{type: string, name: string, [k: string]: any}>}
 */
export function scanMarkup(text) {
	const tokens = [];
	for (const c of classifyTagString(text)) {
		if (c.kind === "status") {
			tokens.push({
				type: "status",
				name: c.name,
				tier: c.tier,
				isVariable: c.tier === 0,
			});
		} else if (c.kind === "story") {
			tokens.push({
				type: "tag",
				name: c.name,
				isSingleUse: c.isSingleUse,
			});
		}
	}
	return tokens;
}

/**
 * Pure rule logic for the Action Grimoire — what a roll context unlocks,
 * what a success costs, and how a Power budget reduces against applied
 * successes. Imported by chat-hooks (post-roll panel) and spend-power
 * (cost preview) so both surfaces show the same answer.
 *
 * Rules sourced from Core Book pp. 146, 151, 154, 158, 159.
 */

/**
 * Verb IDs reachable on a given roll, indexed by roll type. Hardcoded rather
 * than derived from verb-definitions because the mapping isn't 1:1 with
 * `kind` — e.g. Lessen and Restore share `kind: "restore"` but Lessen is
 * Reaction-only.
 */
const ALLOWED_VERBS_BY_TYPE = Object.freeze({
	quick: ["quick", "extraFeat"],
	tracked: [
		"quick",
		"create",
		"bestow",
		"enhance",
		"restore",
		"attack",
		"disrupt",
		"influence",
		"weaken",
		"advance",
		"setBack",
		"discover",
		"extraFeat",
	],
	// Reaction (mitigate) rolls unlock Lessen + Extra Feat.
	mitigate: ["lessen", "extraFeat"],
	// Sacrifice rolls are their own beast: you take Consequences for an
	// extraordinary narrative outcome. No Power-spend menu.
	sacrifice: [],
});

/**
 * Set of verb IDs reachable for this roll. Empty set on Miss or unrecognized
 * roll type.
 *
 * @param {Roll|null|undefined} roll
 * @returns {Set<string>}
 */
export function getAllowedVerbs(roll) {
	const result = roll?.outcome?.label;
	if (!result || result === "consequences") return new Set();
	const type = roll?.litm?.type;
	return new Set(ALLOWED_VERBS_BY_TYPE[type] ?? []);
}

/**
 * Power cost of a success, decomposed into the fixed part (known from the
 * verb and from `[name-N]` / `[name]` / `[name!]` markup) and the count of
 * variable-tier tokens (`[name-]` with no number) that still need a tier
 * chosen at apply time.
 *
 * Quick (narrative-only) and Discover have flat costs regardless of markup.
 * Extra-feat successes live in `extraFeats[]` now, but if one slips into
 * `successes[]` (verb=extraFeat) we still cost it at 1 Power.
 *
 * @param {object|null|undefined} success
 * @returns {{ fixed: number, variableTokens: number, tagCosts: number[] }}
 */
export function getSuccessCost(success) {
	if (!success) return { fixed: 0, variableTokens: 0, tagCosts: [] };

	const def = getVerbDef(success.verb);
	if (!def) return { fixed: 0, variableTokens: 0, tagCosts: [] };

	if (def.kind === "narrative")
		return { fixed: 0, variableTokens: 0, tagCosts: [] };
	if (def.kind === "extraFeat")
		return { fixed: 1, variableTokens: 0, tagCosts: [] };
	if (def.kind === "discover")
		return { fixed: 1, variableTokens: 0, tagCosts: [] };

	return _costFromMarkup(success.text || "");
}

/**
 * Minimum Power a success can be applied for. With one tag (or none) this is
 * the fixed cost. With 2+ tag tokens the player chooses which tags to apply
 * in Spend Power ("either or both" successes), so only the cheapest tag
 * counts toward affordability.
 *
 * @param {{ fixed: number, tagCosts?: number[] }} cost  From getSuccessCost.
 * @returns {number}
 */
export function getMinSuccessCost(cost) {
	const tagCosts = cost.tagCosts ?? [];
	if (tagCosts.length < 2) return cost.fixed;
	const tagSum = tagCosts.reduce((a, b) => a + b, 0);
	return cost.fixed - tagSum + Math.min(...tagCosts);
}

/**
 * The Power actually paid for an applied success: the fixed part minus any
 * deselected tag chips, plus the tiers picked for variable-status tokens.
 * The single encoding of the spend arithmetic — the apply path charges it
 * and the Spend Power dialog's live total mirrors it.
 *
 * @param {{ fixed: number, tagCosts?: number[] }} cost  From getSuccessCost.
 * @param {object} [choices]
 * @param {boolean[]|null} [choices.chosenTags]  Sparse boolean array in
 *   tag-scan order; absent (or any non-false entry) means the tag is applied.
 * @param {number[]} [choices.chosenTiers]  Tier picked per variable-status
 *   token, in scan order.
 * @returns {number}
 */
export function computeSuccessSpend(
	cost,
	{ chosenTags = null, chosenTiers = [] } = {},
) {
	const droppedTags = chosenTags
		? (cost.tagCosts ?? []).reduce(
				(sum, n, i) => sum + (chosenTags[i] === false ? n : 0),
				0,
			)
		: 0;
	const variableSpent = (chosenTiers ?? [])
		.filter((n) => Number.isFinite(n))
		.reduce((sum, n) => sum + n, 0);
	return cost.fixed - droppedTags + variableSpent;
}

/**
 * Sum cost across markup tokens. Tag = 2 Power, single-use tag = 1, status
 * at tier N = N, status with no tier = 1 variable token (priced when the
 * user picks a tier in Spend Power). Individual tag costs are also returned
 * in scan order so Spend Power can offer "either or both" tag selection on
 * successes that list several tags.
 */
function _costFromMarkup(text) {
	let fixed = 0;
	let variableTokens = 0;
	const tagCosts = [];
	for (const tok of scanMarkup(text)) {
		if (tok.type === "tag") {
			const cost = tok.isSingleUse ? 1 : 2;
			fixed += cost;
			tagCosts.push(cost);
		} else if (tok.type === "status") {
			if (tok.isVariable) variableTokens += 1;
			else fixed += tok.tier;
		}
	}
	return { fixed, variableTokens, tagCosts };
}

/**
 * Compute the Power budget for an action panel: total available Power on
 * the roll, total spent across already-applied successes, and the remainder.
 * Applied success costs include any tier choices the player made at apply
 * time, passed in via `appliedCostsById`.
 *
 * @param {Roll|null|undefined} roll
 * @param {{successes?: object[], extraFeats?: string[]}|null|undefined} actionSystem
 * @param {string[]} appliedKeys  Success ids previously applied on the message.
 * @param {Record<string, number>} [appliedCostsById]  Map of success id → actual cost paid.
 *   Falls back to the success's minimum cost (fixed + variableTokens × 1) when absent.
 * @returns {{ power: number, spent: number, remaining: number }}
 */
/**
 * Union of the two applied-success records on a roll message. The
 * appliedSuccessCosts object is the canonical record — object flags merge
 * per-key on concurrent document updates — while the appliedSuccesses array
 * replaces wholesale, so two writers racing on the same message (a local
 * apply and a GM-relayed one, or two relays) can clobber each other's array
 * entry. Reading the union heals a clobbered array.
 *
 * @param {string[]|null} appliedKeys        appliedSuccesses flag
 * @param {object|null} appliedCostsById     appliedSuccessCosts flag
 * @returns {string[]}
 */
export function unionAppliedSuccessKeys(appliedKeys, appliedCostsById) {
	return [
		...new Set([
			...(appliedKeys ?? []),
			...Object.keys(appliedCostsById ?? {}),
		]),
	];
}

export function computePowerBudget(
	roll,
	actionSystem,
	appliedKeys,
	appliedCostsById = {},
) {
	const power = Number(roll?.power) || 0;
	const successesById = new Map(
		(actionSystem?.successes ?? []).map((o) => [o.id, o]),
	);
	const spent = unionAppliedSuccessKeys(appliedKeys, appliedCostsById).reduce(
		(sum, key) => {
		if (key in appliedCostsById) return sum + appliedCostsById[key];
		const cost = getSuccessCost(successesById.get(key));
		// No tier chosen → assume tier 1 for the variable tokens (min cost).
		return sum + cost.fixed + cost.variableTokens;
	}, 0);
	const remaining = Math.max(0, power - spent);
	return { power, spent, remaining };
}
