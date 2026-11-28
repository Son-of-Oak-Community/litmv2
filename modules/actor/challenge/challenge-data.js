import { startsHiddenOn } from "../../active-effects/effect-queries.js";
import { syncTagStringEffects } from "../../item/action/tag-string.js";
import { advanceLimitIn } from "../mixins/actor-limits.js";
import { EffectTagsMixin } from "../mixins/effect-tags-mixin.js";
import { LimitsMixin } from "../mixins/limits-mixin.js";

/**
 * Stable id for a legacy limit stored without one. migrateData runs on every
 * load, and until something persists the limits array a random id would differ
 * each time, orphaning any `limitId` link made in between. Hashing position and
 * label gives the same id every load; position keeps same-labelled limits
 * apart. Shaped like a Foundry id (16 alphanumeric characters).
 * @param {number} index  Position in the source limits array
 * @param {string} [label]
 * @returns {string}
 */
function legacyLimitId(index, label) {
	const input = `${index}:${label ?? ""}`;
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < input.length; i++) {
		const ch = input.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 =
		Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
		Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 =
		Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
		Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	// A 32-bit value is at most 7 base-36 digits; pad each half to 8.
	return [h1, h2].map((h) => (h >>> 0).toString(36).padStart(8, "0")).join("");
}

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
					// What Advance and Set Back added on top of the linked statuses; the
					// recalc keeps it. Negative for a Set Back, so no `min`.
					advanced: new fields.NumberField({ initial: 0, integer: true }),
					// Shown to Limited viewers only once the Narrator reveals it.
					hidden: new fields.BooleanField({ initial: true }),
				}),
			),
			tags: new fields.StringField({
				initial: "",
			}),
		};
	}

	/**
	 * Split the stored `category` string into roles: a book role (Core Book
	 * p.110, `CONFIG.litmv2.challengeRoles`) as its key, matched
	 * case-insensitively so older typed text such as "Quarry" counts; anything
	 * else as typed.
	 * @param {string} value
	 * @returns {string[]}
	 */
	static parseRoles(value) {
		return ChallengeData.#uniqueRoles(String(value ?? "").split(","));
	}

	/**
	 * One role per entry, each once: a book role as its key, matched by key
	 * or by its name as this table reads it ("Здобич"); anything else as
	 * typed. Entries are not split further.
	 * @param {string[]} entries
	 * @returns {string[]}
	 */
	static #uniqueRoles(entries) {
		const known = CONFIG.litmv2?.challengeRoles ?? [];
		const seen = new Set();
		const roles = [];
		for (const raw of entries) {
			const text = String(raw ?? "").trim();
			if (!text) continue;
			const lower = text.toLowerCase();
			const role =
				known.find(
					(k) =>
						k === lower || ChallengeData.roleLabel(k).toLowerCase() === lower,
				) ?? text;
			if (seen.has(role.toLowerCase())) continue;
			seen.add(role.toLowerCase());
			roles.push(role);
		}
		return roles;
	}

	/**
	 * A Challenge's roles with its addons' categories, each once
	 * (case-insensitive by label), sorted by label.
	 * @param {string} category            The stored comma-separated roles
	 * @param {string[]} addonCategories   The addons' categories
	 * @returns {{role: string, label: string}[]}
	 */
	static deriveRoles(category, addonCategories = []) {
		const seen = new Map();
		// The Challenge's own roles are one comma-separated string; an addon's
		// categories are a list already, each entry one category.
		for (const role of ChallengeData.#uniqueRoles([
			...String(category ?? "").split(","),
			...addonCategories,
		])) {
			const label = ChallengeData.roleLabel(role);
			const key = label.toLowerCase();
			if (!seen.has(key)) seen.set(key, { role, label });
		}
		return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
	}

	/**
	 * A role's display label: a book role localized, a custom one as typed.
	 * @param {string} role
	 * @returns {string}
	 */
	static roleLabel(role) {
		const key = String(role).toLowerCase();
		const known = CONFIG.litmv2?.challengeRoles ?? [];
		if (!known.includes(key)) return role;
		return game.i18n.localize(`LITM.ChallengeRoles.${key}`);
	}

	static migrateData(source, options) {
		if (Array.isArray(source.limits)) {
			for (const [index, limit] of source.limits.entries()) {
				if (typeof limit.max === "string") {
					const parsed = Number(limit.max);
					limit.max =
						Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
					if (limit.max === 0) limit.value = 0;
				}
				if (!limit.id) {
					// Partial cleaning is an update diff, which can add a brand-new
					// limit: that needs a unique id. Only a full load is a legacy
					// limit whose id must survive the next load.
					limit.id = options?.partial
						? foundry.utils.randomID()
						: legacyLimitId(index, limit.label);
				}
			}
		}
		return super.migrateData(source, options);
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

		// Derived roles (the book's name for categories): base + addon
		// categories. `derivedRoles` keeps a book role as its key, for its
		// tooltip; `derivedCategories` is the display label of each.
		const roles = ChallengeData.deriveRoles(
			this.category,
			addons.flatMap((a) => a.system.categories),
		);
		this.derivedRoles = roles.map((r) => r.role);
		this.derivedCategories = roles.map((r) => r.label);

		// Derived limits: every tracked limit at its effective max, for display.
		// `this.limits` stays the Challenge's own stored list.
		this.derivedLimits = this.allLimits.map((limit) => ({
			...limit,
			max: this.getEffectiveMax(limit),
		}));

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

	/** @returns {Item[]} This Challenge's addon items. */
	get #addons() {
		return this.parent?.items?.filter((i) => i.type === "addon") ?? [];
	}

	/**
	 * The limits only an addon brings, each with the addon that stores it. A
	 * label the Challenge already has is the Challenge's limit, and of two
	 * addons naming the same new limit the first one holds it.
	 * @returns {{ addon: Item, limit: object }[]}
	 */
	#addonLimits() {
		const own = this.limits;
		const labels = new Set(own.map((l) => l.label.toLowerCase()));
		const ids = new Set(own.map((l) => l.id));
		const found = [];
		for (const addon of this.#addons) {
			for (const limit of addon.system.limits ?? []) {
				const key = limit.label?.toLowerCase();
				if (!key || labels.has(key) || ids.has(limit.id)) continue;
				labels.add(key);
				ids.add(limit.id);
				found.push({ addon, limit });
			}
		}
		return found;
	}

	/**
	 * The Challenge's own limits, then the ones only its addons bring. An
	 * addon's limit is tracked like an own one (value, Advance offset,
	 * visibility), and that state is stored on the addon item.
	 * @override
	 * @returns {object[]}
	 */
	get allLimits() {
		return [
			...this.limits,
			...this.#addonLimits().map(({ limit }) => ({ ...limit })),
		];
	}

	/**
	 * A limit's max is the highest any addon gives a limit of that name.
	 * @override
	 * @param {object} limit
	 * @returns {number}
	 */
	getEffectiveMax(limit) {
		const key = limit.label?.toLowerCase();
		let max = limit.max;
		if (!key) return max;
		for (const addon of this.#addons) {
			for (const other of addon.system.limits ?? []) {
				if (other.label?.toLowerCase() === key && other.max > max)
					max = other.max;
			}
		}
		return max;
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
		return (
			this.alias?.trim() || game.i18n.localize("LITM.Ui.unknown_challenge")
		);
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
	 * Persist limits. Entries the Challenge owns, and new ones, become the
	 * stored `system.limits`. An entry from {@link allLimits} that an addon
	 * brought is written to that addon item instead, and only when it changed.
	 * An addon's limit left out of the list is left as it is, so both
	 * `[...system.limits, newLimit]` and an edited `allLimits` are safe to pass;
	 * {@link removeLimit} deletes one.
	 * @override
	 * @param {object[]} limits
	 * @returns {Promise<void>}
	 */
	async setLimits(limits) {
		const holders = new Map(
			this.#addonLimits().map(({ addon, limit }) => [limit.id, addon]),
		);
		const edits = new Map(
			limits.filter((l) => holders.has(l.id)).map((l) => [l.id, l]),
		);
		const itemUpdates = [];
		for (const addon of new Set(holders.values())) {
			let changed = false;
			const next = addon.system.limits.map((stored) => {
				const edit = edits.get(stored.id);
				if (!edit || holders.get(stored.id) !== addon) return stored;
				const differs = Object.keys(edit).some((k) => edit[k] !== stored[k]);
				changed ||= differs;
				return differs ? { ...stored, ...edit } : stored;
			});
			if (changed) itemUpdates.push({ _id: addon.id, "system.limits": next });
		}

		const result = await this.parent.update({
			"system.limits": limits.filter((l) => !holders.has(l.id)),
		});
		if (itemUpdates.length)
			await this.parent.updateEmbeddedDocuments("Item", itemUpdates);
		return result;
	}

	/**
	 * Delete a limit: an own one from `system.limits`, an addon's from the
	 * addon item.
	 * @override
	 * @param {string} limitId
	 * @returns {Promise<void>}
	 */
	async removeLimit(limitId) {
		const held = this.#addonLimits().find(({ limit }) => limit.id === limitId);
		if (!held) return super.removeLimit(limitId);
		await this.parent.updateEmbeddedDocuments("Item", [
			{
				_id: held.addon.id,
				"system.limits": held.addon.system.limits.filter(
					(l) => l !== held.limit,
				),
			},
		]);
	}

	/**
	 * Advance (or set back) a limit by `delta`, an addon's limit included, up
	 * to its effective max. Resolves to `null` for an id nobody tracks.
	 * @param {string} limitId
	 * @param {number} delta
	 * @returns {Promise<import("../actor-limits.js").LimitChangeResult|null>}
	 */
	async advanceLimit(limitId, delta) {
		const limits = this.allLimits;
		const limit = limits.find((l) => l.id === limitId);
		if (!limit) return null;
		return advanceLimitIn(this.parent, limits, limitId, delta, {
			max: this.getEffectiveMax(limit),
			write: (updated) => this.setLimits(updated),
		});
	}

	/**
	 * Converge this challenge's story/status effects onto bracket tag markup.
	 * Used by the edit→play mode sync; also callable from macros.
	 * @param {string} tagsString
	 * @returns {Promise<void>}
	 */
	async syncEffectsFromTagString(tagsString) {
		// A Challenge's stat block is the Narrator's until revealed tag by tag,
		// unless a player owns it and would lose sight of their own tags.
		return syncTagStringEffects(this.parent, tagsString, {
			hidden: startsHiddenOn(this.parent),
		});
	}
}
