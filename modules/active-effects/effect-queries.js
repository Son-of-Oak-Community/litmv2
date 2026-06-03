/**
 * Read-only queries over an actor's applicable Active Effects.
 *
 * "Applicable" here means anything `allApplicableEffects()` exposes — own
 * effects plus those transferred from owned items. Callers should never
 * walk `actor.effects` directly when they want all of an actor's tags.
 */

/**
 * Whether an effect should be shown to the current user.
 * GMs always see everything; non-GMs are blocked by `isHidden`.
 * @param {ActiveEffect} e
 * @returns {boolean}
 */
export function isEffectVisible(e) {
	return game.user.isGM || !(e.system?.isHidden ?? false);
}

/**
 * Flatten an effect into a plain object suitable for templates and sockets.
 * @param {ActiveEffect} e
 * @returns {object}
 */
export function effectToPlain(e) {
	return {
		_id: e._id,
		id: e.id ?? e._id,
		uuid: e.uuid,
		name: e.name,
		type: e.type,
		system: e.system,
		active: e.active,
		themeId: e.parent?.id,
		themeName: e.parent?.name,
	};
}

/**
 * Partition an actor's applicable effects into buckets by type.
 * @param {Actor} actor
 * @param {...string} types - Effect types to collect (e.g., "story_tag", "status_tag")
 * @returns {Record<string, ActiveEffect[]>} Map of type → effects array
 */
export function partitionEffects(actor, ...types) {
	const buckets = Object.fromEntries(types.map((t) => [t, []]));
	for (const e of actor.allApplicableEffects()) {
		if (e.type in buckets) buckets[e.type].push(e);
	}
	return buckets;
}

/**
 * Find the first applicable effect matching a predicate.
 * @param {Actor} actor
 * @param {Function} predicate - Test function receiving each effect
 * @returns {ActiveEffect|undefined}
 */
export function findApplicableEffect(actor, predicate) {
	for (const e of actor.allApplicableEffects()) {
		if (predicate(e)) return e;
	}
	return undefined;
}

/**
 * Find an ActiveEffect by ID, searching the actor's applicable effects
 * (own + transferred from items), then optionally the fellowship actor.
 * @param {string} effectId
 * @param {Actor} actor
 * @param {{ fellowship?: boolean }} [options]
 * @returns {ActiveEffect|null}
 */
export function resolveEffect(effectId, actor, { fellowship = false } = {}) {
	const byId = (e) => e.id === effectId;
	const match = findApplicableEffect(actor, byId);
	if (match) return match;
	if (fellowship) {
		const f = actor.system?.fellowshipActor;
		if (f) return findApplicableEffect(f, byId) ?? null;
	}
	return null;
}
