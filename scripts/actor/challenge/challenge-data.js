import { EffectTagsMixin } from "../effect-tags-mixin.js";

export class ChallengeData extends EffectTagsMixin(foundry.abstract.TypeDataModel) {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			category: new fields.StringField({
				initial: "",
			}),
			rating: new fields.NumberField({
				required: true,
				initial: 1,
				min: 1,
				max: 5,
			}),
			description: new fields.HTMLField({ initial: "" }),
			might: new fields.ArrayField(
				new fields.SchemaField({
					level: new fields.StringField({
						initial: "adventure",
						choices: ["adventure", "greatness"],
					}),
					description: new fields.StringField({ initial: "" }),
				}),
			),
			specialFeatures: new fields.HTMLField({ initial: "" }),
			limits: new fields.ArrayField(
				new fields.SchemaField({
					id: new fields.StringField({
						initial: () => foundry.utils.randomID(),
					}),
					label: new fields.StringField({ initial: "" }),
					outcome: new fields.StringField({ initial: "" }),
					max: new fields.NumberField({ initial: 3, min: 0, integer: true }),
					value: new fields.NumberField({ initial: 0, min: 0, integer: true }),
				}),
			),
			tags: new fields.StringField({
				initial: "",
			}),
		};
	}

	static migrateData(source) {
		if (Array.isArray(source.limits)) {
			for (const limit of source.limits) {
				if (typeof limit.max === "string") {
					const parsed = Number(limit.max);
					limit.max = Number.isFinite(parsed) && parsed > 0
						? Math.trunc(parsed)
						: 0;
					if (limit.max === 0) limit.value = 0;
				}
				if (!limit.id) {
					limit.id = foundry.utils.randomID();
				}
			}
		}
		return super.migrateData(source);
	}

	/** @override */
	prepareDerivedData() {
		super.prepareDerivedData();
		const addons = this.parent.items.filter((i) => i.type === "addon");

		// Derived rating: base + sum of bonuses, clamped to 5
		this.derivedRating = Math.min(
			5,
			this.rating +
				addons.reduce((sum, a) => sum + (a.system.ratingBonus || 0), 0),
		);

		// Derived categories: base + addon categories, deduplicated (case-insensitive)
		const allCategories = [
			...this.category.split(","),
			...addons.flatMap((a) => a.system.categories),
		].map((c) => c?.trim()).filter(Boolean);
		const seen = new Map();
		for (const c of allCategories) {
			const key = c.toLowerCase();
			if (!seen.has(key)) seen.set(key, c);
		}
		this.derivedCategories = [...seen.values()].sort((a, b) =>
			a.localeCompare(b)
		);

		// Derived limits: merge by lowercase label, keep higher max
		this.derivedLimits = ChallengeData.#mergeLimits(
			this.limits,
			addons.flatMap((a) => a.system.limits),
		);

		// Derived might: concatenate
		this.derivedMight = [
			...this.might,
			...addons.flatMap((a) => a.system.might),
		];

		// Derived tags: concatenate tag strings
		this.derivedTags = [this.tags, ...addons.map((a) => a.system.tags)]
			.filter(Boolean)
			.join(" ");

		// Derived threats: own vignettes stay as-is (handled separately in sheet),
		// addon threats collected here
		this.addonThreats = addons.flatMap((a) =>
			a.system.threats.map((t) => ({ ...t, addonName: a.name }))
		);

		// Collected addon info for badge display
		this.activeAddons = addons.map((a) => ({
			id: a.id,
			name: a.name,
			ratingBonus: a.system.ratingBonus,
		}));
	}

	/**
	 * Merge two limit arrays by lowercase label match, keeping the higher max.
	 * Base limits are authoritative for id, outcome, and value.
	 * @param {object[]} baseLimits
	 * @param {object[]} addonLimits
	 * @returns {object[]}
	 */
	static #mergeLimits(baseLimits, addonLimits) {
		const merged = baseLimits.map((l) => ({ ...l }));
		const labelMap = new Map(
			merged.map((l, i) => [l.label.toLowerCase(), i]),
		);

		for (const addonLimit of addonLimits) {
			if (!addonLimit.label) continue;
			const key = addonLimit.label.toLowerCase();
			const existingIndex = labelMap.get(key);
			if (existingIndex !== undefined) {
				// Merge: keep higher max
				if (addonLimit.max > merged[existingIndex].max) {
					merged[existingIndex].max = addonLimit.max;
				}
			} else {
				// Append unique limit
				labelMap.set(key, merged.length);
				merged.push({ ...addonLimit });
			}
		}

		return merged;
	}

	get challenges() {
		return CONFIG.litmv2.challenge_types;
	}
}
