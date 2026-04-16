import { EFFECT_TYPES } from "../../system/config.js";
import { storyTagEffect, statusTagEffect } from "../../utils.js";

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
		const matches = this.consequences.flatMap((string) =>
			Array.from(string.matchAll(CONFIG.litmv2.tagStringRe)),
		);

		// Build desired effects list from consequence text
		const desired = matches.map(([_, name, separator, value]) => {
			if (separator === "-") {
				return { name, type: EFFECT_TYPES.status_tag, tierIndex: Number(value) };
			}
			return { name, type: EFFECT_TYPES.story_tag, tierIndex: null };
		});

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
				if (d.type === EFFECT_TYPES.status_tag && d.tierIndex != null) {
					const newTiers = Array.from({ length: 6 }, (_, i) => i + 1 === d.tierIndex);
					if (newTiers.some((v, i) => v !== found.system.tiers[i])) {
						toUpdate.push({ _id: found.id, "system.tiers": newTiers });
					}
				}
			} else {
				const effectData = d.type === EFFECT_TYPES.status_tag
					? statusTagEffect({ name: d.name, tiers: Array.from({ length: 6 }, (_, i) => i + 1 === d.tierIndex) })
					: storyTagEffect({ name: d.name });
				toCreate.push(effectData);
			}
		}

		const toDelete = [...existing.values()]
			.filter((e) => !matched.has(e.id))
			.map((e) => e.id);

		if (toDelete.length) await doc.deleteEmbeddedDocuments("ActiveEffect", toDelete);
		if (toUpdate.length) await doc.updateEmbeddedDocuments("ActiveEffect", toUpdate);
		if (toCreate.length) await doc.createEmbeddedDocuments("ActiveEffect", toCreate);
	}
}
