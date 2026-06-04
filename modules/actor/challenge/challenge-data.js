import { advanceSystemLimit } from "../mixins/actor-limits.js";
import { EffectTagsMixin } from "../mixins/effect-tags-mixin.js";
import { LimitsMixin } from "../mixins/limits-mixin.js";

export class ChallengeData extends LimitsMixin(
	EffectTagsMixin(foundry.abstract.TypeDataModel),
) {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			category: new fields.StringField({
				initial: "",
			}),
			concealName: new fields.BooleanField({ initial: false }),
			alias: new fields.StringField({ initial: "" }),
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
					limit.max =
						Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
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
		]
			.map((c) => c?.trim())
			.filter(Boolean);
		const seen = new Map();
		for (const c of allCategories) {
			const key = c.toLowerCase();
			if (!seen.has(key)) seen.set(key, c);
		}
		this.derivedCategories = [...seen.values()].sort((a, b) =>
			a.localeCompare(b),
		);

		// Derived limits: merge by lowercase label, keep higher max.
		// `this.limits` stays canonical (the schema-prepared own property); the
		// merged form is exposed via `this.derivedLimits` and consumers that
		// want the display form select between them explicitly.
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
			a.system.threats.map((t) => ({ ...t, addonName: a.name })),
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
		const labelMap = new Map(merged.map((l, i) => [l.label.toLowerCase(), i]));

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

	/**
	 * Create a new blank limit object for use in add-limit actions.
	 * @returns {object}
	 */
	static newLimit() {
		return {
			id: foundry.utils.randomID(),
			label: game.i18n.localize("LITM.Ui.new_limit"),
			outcome: "",
			max: 3,
			value: 0,
		};
	}

	/**
	 * Challenge type definitions from system config.
	 * Reads from CONFIG.litmv2 (acceptable for static configuration constants).
	 * @returns {object}
	 */
	get challenges() {
		return CONFIG.litmv2.challenge_types;
	}

	/**
	 * The name shown when this challenge's identity is concealed: the
	 * GM-authored alias, or a localized "Unknown Challenge" fallback.
	 * Viewer-independent — use for persisted strings (chat summaries) that
	 * are generated once on one client and shown to everyone, where the
	 * real name must never be baked in even when the GM generates them.
	 * @returns {string}
	 */
	get publicName() {
		if (!this.concealName) return this.parent.name;
		return this.alias?.trim() || game.i18n.localize("LITM.Ui.unknown_challenge");
	}

	/**
	 * The concealed name for the current viewer, or `null` when the viewer
	 * may see the real name (GM, owner, or concealment off). Callers fall
	 * back with `actor.system.maskedName ?? actor.name`, which is also safe
	 * on actor types that don't define this getter.
	 * @returns {string|null}
	 */
	get maskedName() {
		if (!this.concealName || game.user.isGM || this.parent.isOwner) return null;
		return this.publicName;
	}

	/**
	 * Canonical limits live in `system.limits` (schema field), not in
	 * `flags.litmv2.limits` like other actor types. The `LimitsMixin` getter
	 * defines `get limits()` on the prototype without a setter, which causes
	 * Foundry's DataModel initializer to skip assigning the schema-stored
	 * value as an own property — so we must override the getter to read from
	 * source instead.
	 * @override
	 * @returns {object[]}
	 */
	get limits() {
		return this._source.limits ?? [];
	}

	/**
	 * Persist the canonical `system.limits` array. Callers pass the desired
	 * state; addon-derived limits (which live on the addon items) should not
	 * appear here. With `this.limits` left canonical in {@link prepareDerivedData},
	 * the spread-then-write idiom (`[...actor.system.limits, newLimit]`) works
	 * without further filtering.
	 * @override
	 * @param {object[]} limits
	 * @returns {Promise<void>}
	 */
	async setLimits(limits) {
		return this.parent.update({ "system.limits": limits });
	}

	/**
	 * Advance (or set back) a limit by `delta`. Only operates on canonical
	 * `system.limits` entries; addon-derived limits resolve to `null` so
	 * callers can warn the user.
	 * @param {string} limitId
	 * @param {number} delta
	 * @returns {Promise<import("../actor-limits.js").LimitChangeResult|null>}
	 */
	async advanceLimit(limitId, delta) {
		return advanceSystemLimit(this.parent, limitId, delta);
	}
}
