import { ACTOR_TYPES } from "../config.js";

/**
 * Whether a newly created actor should be auto-linked to the world's
 * fellowship singleton. Compendium documents are never linked: the
 * fellowship id is world-scoped, and writing it into a pack would leak
 * this world's id into content shared with other worlds (and fails
 * outright on locked packs).
 * @param {Actor} actor            The created actor
 * @param {string} fellowshipId    The singleton fellowship actor ID
 * @returns {boolean}
 */
export function shouldAutoLinkHero(actor, fellowshipId) {
	if (actor.type !== ACTOR_TYPES.hero) return false;
	if (actor.pack) return false;
	if (!fellowshipId) return false;
	return actor.system.fellowshipId !== fellowshipId;
}
