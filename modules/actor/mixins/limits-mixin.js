import { StatusTagData } from "../../active-effects/index.js";
import {
	announceLimitReached,
	crossedLimitMax,
	getActorLimits,
	resolveLimitValue,
	setActorLimits,
} from "./actor-limits.js";

/**
 * Recalcs queued per actor. A status write recalcs from the ActiveEffect hook
 * (see `_recalcLimitsOnStatusChange`) while the story-tag sidebar awaits its own
 * recalc for the same write; both would read the same stored `value` and both
 * see the crossing. Running them one at a time makes the second see the first's
 * result, so a crossing is announced once.
 * @type {WeakMap<Actor, Promise>}
 */
const recalcQueues = new WeakMap();

async function recalculate(model) {
	const actor = model.parent;
	if (!actor?.isOwner) return { reached: [] };

	const oldLimits = model.limits;
	if (!oldLimits.length) return { reached: [] };

	const effects = [...actor.allApplicableEffects()]
		.filter((e) => e.type === "status_tag" && e.system?.limitId)
		.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));

	const newLimits = oldLimits.map((limit) => {
		const grouped = effects.filter((e) => e.system.limitId === limit.id);
		const tierArrays = grouped.map((e) => e.system.tiers);
		const statusValue = StatusTagData.stackedTier(tierArrays);
		const { value, advanced } = resolveLimitValue(limit, statusValue);
		// `advanced` is written once something has used it, so a limit that
		// predates it is saved back exactly as it was.
		return advanced === (Number(limit.advanced) || 0)
			? { ...limit, value }
			: { ...limit, value, advanced };
	});

	// Detect limits that crossed their threshold during this call
	const reached = [];
	for (let i = 0; i < newLimits.length; i++) {
		const effectiveMax = model.getEffectiveMax(newLimits[i]);
		if (crossedLimitMax(oldLimits[i].value, newLimits[i].value, effectiveMax)) {
			reached.push({ ...newLimits[i], max: effectiveMax });
		}
	}

	if (
		newLimits.some(
			(limit, i) =>
				limit.value !== oldLimits[i].value ||
				limit.advanced !== oldLimits[i].advanced,
		)
	) {
		await model.setLimits(newLimits);
	}
	for (const limit of reached) announceLimitReached(actor, limit);
	return { reached };
}

/**
 * Mixin that adds a uniform limit-access protocol to actor data models.
 *
 * Default behaviour (flag-backed — hero, fellowship, journey):
 *   - `get limits()`              → reads `flags.litmv2.limits`
 *   - `async setLimits(limits)`   → writes `flags.litmv2.limits`
 *   - `getEffectiveMax(limit)`    → `limit.max`
 *
 * ChallengeData overrides `get limits()` and `setLimits()`.
 * HeroData overrides `getEffectiveMax()`.
 *
 * @param {typeof TypeDataModel} Base
 * @returns {typeof TypeDataModel}
 */
export function LimitsMixin(Base) {
	return class extends Base {
		/**
		 * All limits for this actor.
		 * Default: reads from `flags.litmv2.limits` (flag-backed actors).
		 * @returns {object[]}
		 */
		get limits() {
			return getActorLimits(this.parent);
		}

		/**
		 * Persist an updated limits array.
		 * Default: writes to `flags.litmv2.limits` (flag-backed actors).
		 * @param {object[]} limits
		 * @returns {Promise<void>}
		 */
		async setLimits(limits) {
			return setActorLimits(this.parent, limits);
		}

		/**
		 * The effective max for a limit, potentially overriding the stored value.
		 * Default: `limit.max`. HeroData overrides to apply the global heroLimit setting.
		 * @param {object} limit
		 * @returns {number}
		 */
		getEffectiveMax(limit) {
			return limit.max;
		}

		/**
		 * Recompute each limit's `value` from the actor's current status_tag tiers
		 * plus the offset Advance and Set Back left on it (`advanced`, see
		 * `resolveLimitValue`), persist the results, and announce each limit that
		 * just crossed its threshold through `litm.limitReached` (`{ actor, limit }`,
		 * `limit.max` the effective max). This is the one place the hook fires from.
		 *
		 * Only runs when the actor has limits and is the owner, and calls queue
		 * per actor. Whichever client runs it announces, so callers run it where
		 * the change was made: the ActiveEffect hook for status writes, the
		 * story-tag sidebar for its own edits.
		 *
		 * @returns {Promise<{ reached: object[] }>}
		 */
		async recalculateLimitValues() {
			const actor = this.parent;
			if (!actor) return { reached: [] };
			const turn = (recalcQueues.get(actor) ?? Promise.resolve()).then(() =>
				// The live model: an update reinitializes `actor.system`.
				recalculate(actor.system ?? this),
			);
			recalcQueues.set(
				actor,
				turn.catch(() => {}),
			);
			return turn;
		}
	};
}
