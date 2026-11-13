import { maxStatusTier } from "../../active-effects/status-tag-data.js";
import { FLAGS } from "../../system/config.js";
import { localize as t } from "../../utils.js";

/**
 * The Secret Grace (Vol. II p.78): the Narrator's record of a Hero's moments
 * of grace, never shown to players. Each moment marks one tier; on a Sacrifice
 * the Hero adds a Secret Grace Bonus (told only as a number). Kept on the Hero
 * rather than as a status effect, so it can never count as Power or surface
 * wherever statuses are shown.
 *
 * A moment is live or scratched. A scratched one stays listed for history —
 * the book ties later Unexpected Help to them — but no longer counts. A
 * Sacrifice scratches as many moments as its bonus, oldest first; the Narrator
 * may also scratch one by hand.
 *
 * @typedef {{id: string, text: string, scratched?: boolean}} GraceMoment
 */

/**
 * @param {Actor} actor
 * @returns {GraceMoment[]}
 */
export function graceMoments(actor) {
	const moments = actor?.getFlag?.("litmv2", FLAGS.secretGrace);
	return Array.isArray(moments) ? moments : [];
}

/**
 * The moments not yet scratched: the ones that count.
 * @param {Actor} actor
 * @returns {GraceMoment[]}
 */
export function liveGraceMoments(actor) {
	return graceMoments(actor).filter((m) => !m.scratched);
}

/**
 * The tier of the Hero's Secret Grace: one per unused moment, up to the
 * world's top status tier.
 * @param {Actor} actor
 * @returns {number}
 */
export function secretGraceTier(actor) {
	return Math.min(liveGraceMoments(actor).length, maxStatusTier());
}

/**
 * What a viewer calls a Sacrifice's added number: the Narrator's Secret Grace
 * Bonus, a plain Bonus to players (never say where it comes from).
 * @param {User} [user]
 * @returns {string}
 */
export function graceBonusLabel(user = game.user) {
	return t(
		user.isGM ? "LITM.Ui.sacrifice_grace_bonus" : "LITM.Ui.sacrifice_bonus",
	);
}

/**
 * Mark one tier for a moment of grace, noting what the Hero did.
 * @param {Actor} actor
 * @param {string} text
 */
export function markMomentOfGrace(actor, text) {
	return actor.setFlag("litmv2", FLAGS.secretGrace, [
		...graceMoments(actor),
		{ id: foundry.utils.randomID(), text: text.trim(), scratched: false },
	]);
}

/**
 * @param {Actor} actor
 * @param {string} id
 */
export function removeMomentOfGrace(actor, id) {
	return actor.setFlag(
		"litmv2",
		FLAGS.secretGrace,
		graceMoments(actor).filter((m) => m.id !== id),
	);
}

/**
 * Scratch a moment, or restore it: a scratched moment stays listed but no
 * longer counts toward the tier.
 * @param {Actor} actor
 * @param {string} id
 */
export function toggleMomentOfGrace(actor, id) {
	return actor.setFlag(
		"litmv2",
		FLAGS.secretGrace,
		graceMoments(actor).map((m) =>
			m.id === id ? { ...m, scratched: !m.scratched } : m,
		),
	);
}

/**
 * Pay a Sacrifice's Secret Grace Bonus: scratch that many live moments,
 * oldest first. The moments stay listed.
 * @param {Actor} actor
 * @param {number} amount  The bonus the roll was granted.
 * @returns {Promise|undefined} undefined when there was nothing to scratch
 */
export function spendSecretGrace(actor, amount) {
	let left = Math.max(0, Math.trunc(Number(amount)) || 0);
	if (!left || !secretGraceTier(actor)) return;
	return actor.setFlag(
		"litmv2",
		FLAGS.secretGrace,
		graceMoments(actor).map((m) => {
			if (m.scratched || !left) return m;
			left--;
			return { ...m, scratched: true };
		}),
	);
}
