/**
 * Single source of truth for the action-success verb taxonomy.
 *
 * Adding a new verb means adding one entry here (and its i18n strings); the
 * dispatch table in `chat-actions.js`, the cost rule in `action-rules.js`,
 * and the display kind used by the chat panel are all derived from this map.
 *
 * @typedef {object} VerbDef
 * @property {"self"|"ally"|"opponent"|"process"} target
 *   Default target when the success's `payload.target` is not set or is
 *   ambiguous. Drives picker selection in `applySuccess`.
 * @property {"createOrTag"|"weaken"|"restore"|"process"|"discover"|"extraFeat"|"unsupported"} kind
 *   Selects which applier function runs in `applySuccess`. Also used by the
 *   cost calculator (`process` → tier, `discover` → 1, etc.).
 * @property {"self"|"opponent"|"process"|"meta"} displayKind
 *   Visual category for the chat success panel — colors the button by the
 *   semantic family ("hurts them / helps us / changes the situation").
 * @property {boolean} [defaultStatus]
 *   When the success's payload has neither tag nor status name (or has
 *   both), should the verb produce a status by default? Used by
 *   `_applyCreateOrTag`. Falls through to "tag" when omitted.
 * @property {string} [unsupportedMessageKey]
 *   Required for `kind: "unsupported"`. The localization key shown when a
 *   user clicks a success with this verb.
 */

/** @type {Record<string, VerbDef>} */
export const VERB_DEFINITIONS = Object.freeze({
	// Opponent-targeted
	attack: {
		target: "opponent",
		kind: "createOrTag",
		displayKind: "opponent",
		defaultStatus: true,
	},
	disrupt: { target: "opponent", kind: "createOrTag", displayKind: "opponent" },
	influence: {
		target: "opponent",
		kind: "createOrTag",
		displayKind: "opponent",
		defaultStatus: true,
	},
	weaken: { target: "opponent", kind: "weaken", displayKind: "opponent" },

	// Self/ally-targeted
	bestow: { target: "self", kind: "createOrTag", displayKind: "self" },
	create: { target: "self", kind: "createOrTag", displayKind: "self" },
	enhance: {
		target: "self",
		kind: "createOrTag",
		displayKind: "self",
		defaultStatus: true,
	},
	restore: { target: "self", kind: "restore", displayKind: "self" },

	// Process (Limit) verbs
	advance: { target: "process", kind: "process", displayKind: "process" },
	setBack: { target: "process", kind: "process", displayKind: "process" },
	// Lessen reaches the Restore applier on `self` — it's a reaction to
	// something coming at the Hero, mechanically equivalent to Restore but
	// reached via the Reaction roll type rather than a Detailed action.
	lessen: { target: "self", kind: "restore", displayKind: "self" },

	// Meta
	quick: { target: "self", kind: "narrative", displayKind: "meta" },
	discover: { target: "self", kind: "discover", displayKind: "meta" },
	extraFeat: { target: "self", kind: "extraFeat", displayKind: "meta" },
});

/** Frozen list of all verb identifiers, in declaration order. */
export const SUCCESS_VERBS = Object.freeze(Object.keys(VERB_DEFINITIONS));

/**
 * Get the definition for a verb. Returns `null` for unknown verbs.
 * @param {string} verb
 * @returns {VerbDef|null}
 */
export function getVerbDef(verb) {
	return VERB_DEFINITIONS[verb] ?? null;
}

/**
 * Resolve how a success picks its target. The single encoding of the
 * def-vs-payload precedence — `_resolveTarget` (chat-actions.js) dispatches
 * on it and the Spend Power dialog uses it to decide whether to show the
 * target chip row, so the two can't drift.
 *
 * "process" and "opponent" on the verb definition override the payload
 * (an Attack stays an attack no matter what the payload declares); the
 * softer "ally"/"prompt" modes come from the payload.
 *
 * @param {VerbDef|null} def      From getVerbDef.
 * @param {object} [success]      The success whose payload may declare a target.
 * @returns {"self"|"ally"|"opponent"|"prompt"|"process"}
 */
export function successTargetMode(def, success) {
	const declared = success?.payload?.target ?? "self";
	if (def?.target === "process" || declared === "process") return "process";
	if (def?.target === "opponent" || declared === "opponent") return "opponent";
	if (def?.target === "ally" || declared === "ally") return "ally";
	if (declared === "prompt") return "prompt";
	return "self";
}
