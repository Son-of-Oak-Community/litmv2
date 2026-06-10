/**
 * Factory functions that build properly-shaped ActiveEffect creation data
 * for each of the six Litm AE types, plus batched-update routing for
 * effects that may live on either an actor or one of its embedded items.
 */

export function powerTagEffect({
	name,
	isActive = false,
	question = null,
	isScratched = false,
} = {}) {
	return {
		name: name || game.i18n.localize("LITM.Terms.tag"),
		type: "power_tag",
		disabled: !isActive,
		system: { question, isScratched },
	};
}

export function weaknessTagEffect({
	name,
	isActive = false,
	question = null,
} = {}) {
	return {
		name: name || game.i18n.localize("LITM.Terms.tag"),
		type: "weakness_tag",
		disabled: !isActive,
		system: { question },
	};
}

export function fellowshipTagEffect({
	name,
	isActive = false,
	question = null,
	isScratched = false,
} = {}) {
	return {
		name: name || game.i18n.localize("LITM.Terms.tag"),
		type: "fellowship_tag",
		disabled: !isActive,
		system: { question, isScratched },
	};
}

export function relationshipTagEffect({ name, targetId = "" } = {}) {
	return {
		name: name || game.i18n.localize("LITM.Terms.tag"),
		type: "relationship_tag",
		system: { targetId },
	};
}

/**
 * Build ActiveEffect creation data for a story_tag effect.
 * @param {object} options
 * @param {string} options.name - Tag name
 * @param {boolean} [options.isScratched=false]
 * @param {boolean} [options.isSingleUse=false]
 * @param {boolean} [options.isHidden=false]
 * @param {string|null} [options.limitId=null]
 * @returns {object} Effect creation data
 */
export function storyTagEffect({
	name,
	isScratched = false,
	isSingleUse = false,
	isHidden = false,
	limitId = null,
} = {}) {
	return {
		name: name || game.i18n.localize("LITM.Terms.tag"),
		type: "story_tag",
		system: { isScratched, isSingleUse, isHidden, limitId },
	};
}

/**
 * Build ActiveEffect creation data for a status_tag effect.
 * @param {object} options
 * @param {string} options.name - Status name
 * @param {boolean[]} [options.tiers] - 6-element tier array
 * @param {boolean} [options.isHidden=false]
 * @param {string|null} [options.limitId=null]
 * @returns {object} Effect creation data
 */
export function statusTagEffect({
	name,
	tiers = [false, false, false, false, false, false],
	isHidden = false,
	limitId = null,
} = {}) {
	return {
		name: name || game.i18n.localize("LITM.Terms.status"),
		type: "status_tag",
		system: { tiers, isHidden, limitId },
	};
}

/**
 * Converge a document's tag/status effects onto a desired list of effect
 * creation data (as produced by the factories above): create what's missing,
 * update what differs, delete what's no longer desired. Matching keys by
 * trimmed case-insensitive name + type; duplicate desired entries are ignored
 * after the first.
 *
 * Only declarative fields are updated on a match — `name` casing,
 * `system.tiers` (statuses) and `system.isSingleUse` (story tags). Runtime
 * state like `isScratched` is deliberately left alone so a re-sync never
 * clobbers play state.
 *
 * @param {Document} doc       Actor or Item owning the effects
 * @param {object[]} desired   Effect creation data ({ name, type, system })
 * @param {object} [options]
 * @param {(effect: ActiveEffect) => boolean} [options.filter]
 *        Which existing effects participate in reconciliation; effects
 *        excluded here are never updated or deleted.
 * @returns {Promise<void>}
 */
export async function reconcileTagEffects(
	doc,
	desired,
	{ filter = () => true } = {},
) {
	const existing = doc.effects.filter(filter);
	const keyOf = (name, type) => `${type}::${name.trim().toLowerCase()}`;
	const existingByKey = new Map();
	for (const e of existing) {
		const key = keyOf(e.name, e.type);
		if (!existingByKey.has(key)) existingByKey.set(key, e);
	}

	const matchedIds = new Set();
	const seenKeys = new Set();
	const toCreate = [];
	const toUpdate = [];

	for (const d of desired) {
		const key = keyOf(d.name, d.type);
		if (seenKeys.has(key)) continue;
		seenKeys.add(key);

		const match = existingByKey.get(key);
		if (!match) {
			toCreate.push(d);
			continue;
		}
		matchedIds.add(match.id);

		const update = { _id: match.id };
		const newName = d.name.trim();
		if (match.name !== newName) update.name = newName;
		const newTiers = d.system?.tiers;
		if (Array.isArray(newTiers)) {
			const currentTiers = match.system.tiers ?? [];
			if (newTiers.some((v, i) => !!v !== !!currentTiers[i])) {
				update["system.tiers"] = newTiers;
			}
		}
		const newSingleUse = d.system?.isSingleUse;
		if (
			newSingleUse !== undefined &&
			!!match.system.isSingleUse !== !!newSingleUse
		) {
			update["system.isSingleUse"] = newSingleUse;
		}
		if (Object.keys(update).length > 1) toUpdate.push(update);
	}

	const toDelete = existing
		.filter((e) => !matchedIds.has(e.id))
		.map((e) => e.id);

	if (toDelete.length) {
		await doc.deleteEmbeddedDocuments("ActiveEffect", toDelete);
	}
	if (toUpdate.length) {
		await doc.updateEmbeddedDocuments("ActiveEffect", toUpdate);
	}
	if (toCreate.length) {
		await doc.createEmbeddedDocuments("ActiveEffect", toCreate);
	}
}

/**
 * Route effect updates to the correct parent document and batch-apply them.
 * Effects may live on the actor directly or on embedded items (e.g. backpack).
 * Builds an id→effect lookup once, then groups updates by parent.
 * @param {Actor} actor    The actor whose applicable effects to search
 * @param {object[]} updates  Array of update objects with `_id` keys
 */
export async function updateEffectsByParent(actor, updates) {
	if (!updates.length) return;
	const effectMap = new Map(
		[...actor.allApplicableEffects()].map((e) => [e.id, e]),
	);
	const byParent = new Map();
	for (const u of updates) {
		const parent = effectMap.get(u._id)?.parent ?? actor;
		if (!byParent.has(parent)) byParent.set(parent, []);
		byParent.get(parent).push(u);
	}
	for (const [parent, parentUpdates] of byParent) {
		await parent.updateEmbeddedDocuments("ActiveEffect", parentUpdates);
	}
}
