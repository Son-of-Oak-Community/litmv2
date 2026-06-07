import {
	statusTagEffect,
	storyTagEffect,
} from "../../active-effects/effect-factories.js";
import { EFFECT_TYPES } from "../../system/config.js";
import { parseTagString } from "../action/tag-string.js";

export class VignetteData extends foundry.abstract.TypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			threat: new fields.StringField({
				initial: "",
			}),
			consequences: new fields.ArrayField(
				new fields.StringField({ required: false, nullable: false }),
				{
					initial: () => [],
				},
			),
			isConsequenceOnly: new fields.BooleanField({
				initial: false,
			}),
		};
	}

	/**
	 * Synchronize embedded effects to match consequence text.
	 * Parses tag/status markup from each consequence string, then
	 * creates, updates, or deletes ActiveEffects so the item's
	 * effects mirror the parsed result.
	 * @returns {Promise<void>}
	 */
	async syncEffectsFromConsequences() {
		const doc = this.parent;
		// Parse consequence markup with the canonical tag-string parser so
		// `[name-N]` yields a status_tag (with a one-hot tiers array) and
		// `[name]` a story_tag — matching the rest of the system.
		const desired = this.consequences.flatMap(parseTagString);

		// Key existing effects for matching
		const existing = new Map();
		for (const e of doc.effects) {
			existing.set(`${e.type}::${e.name}`, e);
		}

		const toCreate = [];
		const toUpdate = [];
		const matched = new Set();

		for (const d of desired) {
			const key = `${d.type}::${d.name}`;
			const found = existing.get(key);
			if (found) {
				matched.add(found.id);
				if (d.type === EFFECT_TYPES.status_tag) {
					const newTiers = d.system.tiers;
					if (newTiers.some((v, i) => v !== found.system.tiers[i])) {
						toUpdate.push({ _id: found.id, "system.tiers": newTiers });
					}
				}
			} else {
				const effectData =
					d.type === EFFECT_TYPES.status_tag
						? statusTagEffect({ name: d.name, tiers: d.system.tiers })
						: storyTagEffect({ name: d.name });
				toCreate.push(effectData);
			}
		}

		const toDelete = [...existing.values()]
			.filter((e) => !matched.has(e.id))
			.map((e) => e.id);

		if (toDelete.length)
			await doc.deleteEmbeddedDocuments("ActiveEffect", toDelete);
		if (toUpdate.length)
			await doc.updateEmbeddedDocuments("ActiveEffect", toUpdate);
		if (toCreate.length)
			await doc.createEmbeddedDocuments("ActiveEffect", toCreate);
	}
}
