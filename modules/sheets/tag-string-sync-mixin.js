import { ACTOR_TAG_TYPES } from "../system/config.js";

/**
 * Mixin that adds bidirectional tag-string ↔ ActiveEffect synchronisation.
 * Shared by ChallengeSheet and JourneySheet, both of which store a `system.tags`
 * string that is the canonical representation in edit mode, while ActiveEffects
 * are the canonical representation in play mode.
 *
 * **Hook lifetime contract:** The mixin registers three global ActiveEffect
 * listeners in `_onFirstRender` and removes them in `_onClose`. Both `#hookIds`
 * and `#syncing` are true private fields (declared via `#`) so subclasses
 * cannot accidentally shadow them — if a subclass overrides `_onFirstRender`
 * or `_onClose`, it MUST call `super` so registration and cleanup stay paired.
 * Failing to call super on either side leaks listeners that close over a
 * stale `this.document`.
 *
 * @param {typeof LitmActorSheet} Base
 * @returns {typeof LitmActorSheet}
 */
export function TagStringSyncMixin(Base) {
	return class extends Base {
		/** Flag to prevent hook feedback loops during effect sync. */
		#syncing = false;
		/** Hook IDs returned by Hooks.on, indexed by event name. */
		#hookIds = null;

		/* -------------------------------------------- */
		/*  Tag String ↔ Effects                        */
		/* -------------------------------------------- */

		_effectsToTagString() {
			const effects = this.document.effects.filter(
				(e) => ACTOR_TAG_TYPES.has(e.type) && !e.getFlag("litmv2", "addonId"),
			);
			return effects.map((e) => e.system.toTagString(e.name)).join(", ");
		}

		async _syncEffectsFromString(tagsString) {
			// Weakness/limit markup is enricher-only — only stories and
			// statuses materialize as effects (syncTagStringEffects filters).
			await this.document.system.syncEffectsFromTagString(tagsString);
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
			if (this.system.tags?.length && !this.#syncing) {
				const hasEffects = this.document.effects.some(
					(e) => ACTOR_TAG_TYPES.has(e.type) && !e.getFlag("litmv2", "addonId"),
				);
				if (!hasEffects) {
					this.#syncing = true;
					await this._syncEffectsFromString(this.system.tags);
					this.#syncing = false;
				}
			}
		}

		/** @override */
		async _onFirstRender(context, options) {
			await super._onFirstRender(context, options);
			if (this.document.isOwner) {
				this._syncTagsAndEffects().catch((err) => {
					const error =
						err instanceof Error ? err : new Error(String(err), { cause: err });
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
			this.#hookIds = {
				create: Hooks.on("createActiveEffect", (effect) => {
					if (effect.parent !== this.document) return;
					if (this.#syncing) return;
					if (!this.document.isOwner) return;
					if (!ACTOR_TAG_TYPES.has(effect.type)) return;
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
					if (this.#syncing) return;
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
					if (this.#syncing) return;
					if (!this.document.isOwner) return;
					if (!ACTOR_TAG_TYPES.has(effect.type)) return;
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
			if (this.#hookIds) {
				Hooks.off("createActiveEffect", this.#hookIds.create);
				Hooks.off("updateActiveEffect", this.#hookIds.update);
				Hooks.off("deleteActiveEffect", this.#hookIds.delete);
			}
			return super._onClose(options);
		}

		/* -------------------------------------------- */
		/*  Mode Switching                              */
		/* -------------------------------------------- */

		/** @override */
		async _onChangeSheetMode() {
			const wasEditMode = this._isEditMode;
			await this.submit();
			if (wasEditMode) {
				// Sync effects from the persisted tag string
				this.#syncing = true;
				await this._syncEffectsFromString(this.system.tags ?? "");
				this.#syncing = false;
			}
			// Toggle mode via render option to avoid race with submit-triggered re-render
			const newMode = wasEditMode
				? this.constructor.MODES.PLAY
				: this.constructor.MODES.EDIT;
			return this.render({ force: true, mode: newMode });
		}
	};
}
