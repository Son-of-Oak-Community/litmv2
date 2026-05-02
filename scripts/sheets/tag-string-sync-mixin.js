import { ACTOR_TAG_TYPES } from "../system/config.js";

/**
 * Mixin that adds bidirectional tag-string ↔ ActiveEffect synchronisation.
 * Shared by ChallengeSheet and JourneySheet, both of which store a `system.tags`
 * string that is the canonical representation in edit mode, while ActiveEffects
 * are the canonical representation in play mode.
 *
 * @param {typeof LitmActorSheet} Base
 * @returns {typeof LitmActorSheet}
 */
export function TagStringSyncMixin(Base) {
	return class extends Base {
		/**
		 * Flag to prevent hook feedback loops during effect sync.
		 * @type {boolean}
		 */
		_syncing = false;

		/* -------------------------------------------- */
		/*  Tag String ↔ Effects                        */
		/* -------------------------------------------- */

		_effectsToTagString() {
			const effects = this.document.effects.filter(
				(e) =>
					ACTOR_TAG_TYPES.has(e.type) &&
					!e.getFlag("litmv2", "addonId"),
			);
			return effects
				.map((e) => e.system.toTagString(e.name))
				.join(", ");
		}

		async _syncEffectsFromString(tagsString) {
			const matches = Array.from(
				tagsString.matchAll(CONFIG.litmv2.tagStringRe),
			);
			const parsed = matches.map(([_, name, separator, value]) => ({
				name,
				isStatus: separator === "-",
				tier: Number.parseInt(value, 10) || 0,
			}));

			const existing = this.document.effects.filter(
				(e) =>
					ACTOR_TAG_TYPES.has(e.type) &&
					!e.getFlag("litmv2", "addonId"),
			);
			// Key by name + type so a tag and a status of the same name can coexist.
			const keyOf = (name, type) => `${name.trim().toLowerCase()} ${type}`;
			const existingByKey = new Map(
				existing.map((e) => [keyOf(e.name, e.type), e]),
			);

			const matchedIds = new Set();
			const seenKeys = new Set();
			const toCreate = [];
			const toUpdate = [];

			for (const t of parsed) {
				const expectedType = t.isStatus ? "status_tag" : "story_tag";
				const key = keyOf(t.name, expectedType);
				// Skip duplicate parsed entries so toUpdate/toCreate stay unique.
				if (seenKeys.has(key)) continue;
				seenKeys.add(key);

				const match = existingByKey.get(key);
				if (match) {
					matchedIds.add(match.id);
					const update = { _id: match.id };
					const newName = t.name.trim();
					if (match.name !== newName) update.name = newName;
					if (t.isStatus) {
						const newTiers = Array(6)
							.fill(false)
							.map((_, i) => i + 1 === t.tier);
						const currentTiers = match.system.tiers ?? [];
						const tiersDiffer = newTiers.some(
							(v, i) => v !== !!currentTiers[i],
						);
						if (tiersDiffer) update["system.tiers"] = newTiers;
					}
					if (Object.keys(update).length > 1) toUpdate.push(update);
				} else {
					toCreate.push({
						name: t.name,
						type: expectedType,
						system: t.isStatus
							? {
								tiers: Array(6)
									.fill(false)
									.map((_, i) => i + 1 === t.tier),
							}
							: { isScratched: false, isSingleUse: false },
					});
				}
			}

			const toDelete = existing
				.filter((e) => !matchedIds.has(e.id))
				.map((e) => e.id);

			if (toDelete.length) {
				await this.document.deleteEmbeddedDocuments("ActiveEffect", toDelete);
			}
			if (toUpdate.length) {
				await this.document.updateEmbeddedDocuments("ActiveEffect", toUpdate);
			}
			if (toCreate.length) {
				await this.document.createEmbeddedDocuments("ActiveEffect", toCreate);
			}

			this._notifyStoryTags();
		}

		/* -------------------------------------------- */
		/*  External Effect Hooks                       */
		/* -------------------------------------------- */

		/**
		 * Ensure tags string and ActiveEffect documents are in sync on first render.
		 * Handles the case where a GM typed tags in edit mode but never switched to
		 * play mode (effects don't exist yet), or effects exist but the string is empty.
		 */
		async _syncTagsAndEffects() {
			// Ensure system.tags is populated from effects if empty
			if (!this.system.tags) {
				const tagString = this._effectsToTagString();
				if (tagString) {
					await this.document.update({ "system.tags": tagString });
				}
			}

			// Ensure effects exist from string
			if (this.system.tags?.length && !this._syncing) {
				const hasEffects = this.document.effects.some(
					(e) =>
						ACTOR_TAG_TYPES.has(e.type) &&
						!e.getFlag("litmv2", "addonId"),
				);
				if (!hasEffects) {
					this._syncing = true;
					await this._syncEffectsFromString(this.system.tags);
					this._syncing = false;
				}
			}
		}

		/** @override */
		async _onFirstRender(context, options) {
			await super._onFirstRender(context, options);
			if (this.document.isOwner) {
				this._syncTagsAndEffects().catch((err) => {
					const error = err instanceof Error
						? err
						: new Error(String(err), { cause: err });
					Hooks.onError(
						`litmv2.${this.document.type}Sheet.syncTagsAndEffects`,
						error,
						{
							msg: "[litmv2]",
							log: "error",
							notify: null,
						},
					);
				});
			}
			this._hookIds = {
				create: Hooks.on("createActiveEffect", (effect) => {
					if (effect.parent !== this.document) return;
					if (this._syncing) return;
					if (!this.document.isOwner) return;
					if (effect.type !== "story_tag" && effect.type !== "status_tag") {
						return;
					}
					if (effect.getFlag("litmv2", "addonId")) return;
					const tag = effect.system.toTagString(effect.name);
					const current = this.system.tags || "";
					const separator = current.length ? ", " : "";
					this.document.update({
						"system.tags": current + separator + tag,
					});
				}),
				update: Hooks.on("updateActiveEffect", (effect) => {
					if (effect.parent !== this.document) return;
					if (this._syncing) return;
					if (!this.document.isOwner) return;
					if (effect.type !== "status_tag") return;
					const name = effect.name;
					const newTier = effect.system?.currentTier ?? 0;
					let tags = this.system.tags || "";
					const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
					const re = new RegExp(
						`([\\[{]${escaped})[\\s\\-:](\\d+)([\\]}])`,
						"i",
					);
					if (re.test(tags)) {
						tags = tags.replace(re, `$1-${newTier}$3`);
						this.document.update({ "system.tags": tags });
					}
				}),
				delete: Hooks.on("deleteActiveEffect", (effect) => {
					if (effect.parent !== this.document) return;
					if (this._syncing) return;
					if (!this.document.isOwner) return;
					if (effect.type !== "story_tag" && effect.type !== "status_tag") {
						return;
					}
					if (effect.getFlag("litmv2", "addonId")) return;
					const name = effect.name;
					const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
					let tags = this.system.tags || "";
					// Remove [name], {name}, [name-N], {name-N}
					const re = new RegExp(
						`[\\[{]${escaped}(?:[\\s\\-:]\\d+)?[\\]}]`,
						"gi",
					);
					tags = tags.replace(re, "").trim();
					// Clean up orphaned separators
					tags = tags
						.replace(/,\s*,/g, ",")
						.replace(/^\s*,|,\s*$/g, "")
						.trim();
					this.document.update({ "system.tags": tags });
				}),
			};
		}

		/** @override */
		_onClose(options) {
			if (this._hookIds) {
				Hooks.off("createActiveEffect", this._hookIds.create);
				Hooks.off("updateActiveEffect", this._hookIds.update);
				Hooks.off("deleteActiveEffect", this._hookIds.delete);
			}
			return super._onClose(options);
		}

		/* -------------------------------------------- */
		/*  Mode Switching                              */
		/* -------------------------------------------- */

		/** @override */
		async _onChangeSheetMode(_event, _target) {
			const wasEditMode = this._isEditMode;
			await this.submit();
			if (wasEditMode) {
				// Sync effects from the persisted tag string
				this._syncing = true;
				await this._syncEffectsFromString(this.system.tags ?? "");
				this._syncing = false;
			}
			// Toggle mode via render option to avoid race with submit-triggered re-render
			const newMode = wasEditMode
				? this.constructor.MODES.PLAY
				: this.constructor.MODES.EDIT;
			return this.render({ force: true, mode: newMode });
		}
	};
}
