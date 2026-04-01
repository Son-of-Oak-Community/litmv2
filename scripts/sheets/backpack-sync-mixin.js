/**
 * Mixin that synchronises a hero's backpack item contents with transferred
 * ActiveEffects.  The backpack item's `system.contents` array is the source
 * of truth; effects on the item (with `transfer: true`) are the derived
 * play-mode representation that propagates to the parent actor via Foundry's
 * standard transfer mechanics.
 *
 * Modeled on TagStringSyncMixin — same lifecycle hooks, same _syncing guard.
 *
 * @param {typeof LitmActorSheet} Base
 * @returns {typeof LitmActorSheet}
 */
export function BackpackSyncMixin(Base) {
	return class extends Base {
		/**
		 * Flag to prevent hook feedback loops during sync.
		 * @type {boolean}
		 */
		_syncing = false;

		/* -------------------------------------------- */
		/*  Contents → Effects sync                     */
		/* -------------------------------------------- */

		/**
		 * Get the hero's backpack item, if any.
		 * @returns {Item|null}
		 */
		_getBackpackItem() {
			return this.document.items.find((i) => i.type === "backpack") ?? null;
		}

		/**
		 * Synchronise backpack contents → effects on the backpack item.
		 * Creates, updates, or deletes effects to match the contents array.
		 * @returns {Promise<void>}
		 */
		async _syncContentsToEffects() {
			const backpack = this._getBackpackItem();
			if (!backpack) return;

			const contents = backpack.system.contents ?? [];
			const existingEffects = backpack.effects;

			// Build a map of contentsId → effect for quick lookup
			const effectsByContentsId = new Map();
			for (const effect of existingEffects) {
				const cid = effect.getFlag("litmv2", "contentsId");
				if (cid) effectsByContentsId.set(cid, effect);
			}

			const toCreate = [];
			const toUpdate = [];
			const matchedIds = new Set();

			for (const tag of contents) {
				const existing = effectsByContentsId.get(tag.id);
				if (existing) {
					matchedIds.add(existing.id);
					// Check if update needed
					const needsUpdate =
						existing.name !== tag.name ||
						existing.disabled !== !tag.isActive ||
						existing.system.isScratched !== (tag.isScratched ?? false) ||
						existing.system.isSingleUse !== (tag.isSingleUse ?? false);

					if (needsUpdate) {
						toUpdate.push({
							_id: existing.id,
							name: tag.name,
							disabled: !tag.isActive,
							"system.isScratched": tag.isScratched ?? false,
							"system.isSingleUse": tag.isSingleUse ?? false,
						});
					}
				} else {
					toCreate.push({
						name: tag.name,
						type: "story_tag",
						transfer: true,
						disabled: !tag.isActive,
						system: {
							isScratched: tag.isScratched ?? false,
							isSingleUse: tag.isSingleUse ?? false,
							isHidden: false,
						},
						flags: { litmv2: { contentsId: tag.id } },
					});
				}
			}

			// Effects whose contentsId is no longer in contents
			const toDelete = existingEffects
				.filter((e) => {
					const cid = e.getFlag("litmv2", "contentsId");
					return cid && !contents.some((t) => t.id === cid);
				})
				.map((e) => e.id);

			// Batch operations
			if (toDelete.length) {
				await backpack.deleteEmbeddedDocuments("ActiveEffect", toDelete);
			}
			if (toCreate.length) {
				await backpack.createEmbeddedDocuments("ActiveEffect", toCreate);
			}
			if (toUpdate.length) {
				await backpack.updateEmbeddedDocuments("ActiveEffect", toUpdate);
			}

			this._notifyStoryTags();
		}

		/**
		 * Sync a single effect's changes back to the backpack contents array.
		 * @param {ActiveEffect} effect
		 * @returns {Promise<void>}
		 */
		async _syncEffectToContents(effect) {
			const backpack = this._getBackpackItem();
			if (!backpack) return;

			const contentsId = effect.getFlag("litmv2", "contentsId");
			if (!contentsId) return;

			const contents = backpack.system.toObject().contents;
			const entry = contents.find((t) => t.id === contentsId);
			if (!entry) return;

			let changed = false;
			if (entry.name !== effect.name) {
				entry.name = effect.name;
				changed = true;
			}
			if (entry.isActive !== !effect.disabled) {
				entry.isActive = !effect.disabled;
				changed = true;
			}
			if ((entry.isScratched ?? false) !== (effect.system.isScratched ?? false)) {
				entry.isScratched = effect.system.isScratched ?? false;
				changed = true;
			}
			if ((entry.isSingleUse ?? false) !== (effect.system.isSingleUse ?? false)) {
				entry.isSingleUse = effect.system.isSingleUse ?? false;
				changed = true;
			}

			if (changed) {
				await backpack.update({ "system.contents": contents });
			}
		}

		/**
		 * Remove a contents entry when its corresponding effect is deleted.
		 * @param {ActiveEffect} effect
		 * @returns {Promise<void>}
		 */
		async _removeContentsEntry(effect) {
			const backpack = this._getBackpackItem();
			if (!backpack) return;

			const contentsId = effect.getFlag("litmv2", "contentsId");
			if (!contentsId) return;

			const contents = backpack.system.toObject().contents;
			const filtered = contents.filter((t) => t.id !== contentsId);
			if (filtered.length !== contents.length) {
				await backpack.update({ "system.contents": filtered });
			}
		}

		/* -------------------------------------------- */
		/*  Lifecycle Hooks                             */
		/* -------------------------------------------- */

		/** @override */
		async _onFirstRender(context, options) {
			await super._onFirstRender(context, options);

			// Initial sync: ensure effects exist for all contents entries
			if (this.document.isOwner) {
				this._syncing = true;
				this._syncContentsToEffects()
					.catch((err) => {
						const error =
							err instanceof Error
								? err
								: new Error(String(err), { cause: err });
						Hooks.onError(
							"litmv2.heroSheet.syncBackpackContents",
							error,
							{ msg: "[litmv2]", log: "error", notify: null },
						);
					})
					.finally(() => {
						this._syncing = false;
					});
			}

			// Register hooks for reverse sync (effect → contents)
			this._backpackHookIds = {
				update: Hooks.on("updateActiveEffect", (effect) => {
					if (this._syncing) return;
					if (!this.document.isOwner) return;
					if (effect.type !== "story_tag") return;
					// Only handle effects on our backpack item
					const backpack = this._getBackpackItem();
					if (!backpack || effect.parent !== backpack) return;
					if (!effect.getFlag("litmv2", "contentsId")) return;

					this._syncing = true;
					this._syncEffectToContents(effect)
						.finally(() => { this._syncing = false; });
				}),
				delete: Hooks.on("deleteActiveEffect", (effect) => {
					if (this._syncing) return;
					if (!this.document.isOwner) return;
					if (effect.type !== "story_tag") return;
					const backpack = this._getBackpackItem();
					if (!backpack || effect.parent !== backpack) return;
					if (!effect.getFlag("litmv2", "contentsId")) return;

					this._syncing = true;
					this._removeContentsEntry(effect)
						.finally(() => { this._syncing = false; });
				}),
			};
		}

		/** @override */
		_onClose(options) {
			if (this._backpackHookIds) {
				Hooks.off("updateActiveEffect", this._backpackHookIds.update);
				Hooks.off("deleteActiveEffect", this._backpackHookIds.delete);
			}
			return super._onClose(options);
		}

		/** @override */
		async _onChangeSheetMode(_event, _target) {
			const wasEditMode = this._isEditMode;
			await this.submit();
			if (wasEditMode) {
				// Switching to play mode: sync contents → effects
				this._syncing = true;
				await this._syncContentsToEffects();
				this._syncing = false;
			}
			this._mode = wasEditMode
				? this.constructor.MODES.PLAY
				: this.constructor.MODES.EDIT;
			return this.render(true);
		}

		/* -------------------------------------------- */
		/*  Helper Methods                              */
		/* -------------------------------------------- */

		/**
		 * Add a tag to the backpack contents. The sync creates the effect.
		 * @param {object} tagData - Tag data (name, isActive, etc.)
		 * @returns {Promise<void>}
		 */
		async addTag(tagData) {
			const backpack = this._getBackpackItem();
			if (!backpack) return;

			const entry = {
				id: tagData.id ?? foundry.utils.randomID(),
				name: tagData.name ?? game.i18n.localize("LITM.Terms.tag"),
				isActive: tagData.isActive ?? true,
				isScratched: tagData.isScratched ?? false,
				isSingleUse: tagData.isSingleUse ?? false,
				type: "backpack",
				question: "",
			};
			const contents = [...backpack.system.contents, entry];
			await backpack.update({ "system.contents": contents });
			this._syncing = true;
			await this._syncContentsToEffects();
			this._syncing = false;
		}

		/**
		 * Remove a tag from the backpack contents by its id.
		 * @param {string} tagId
		 * @returns {Promise<void>}
		 */
		async removeTag(tagId) {
			const backpack = this._getBackpackItem();
			if (!backpack) return;

			const contents = backpack.system.contents.filter((t) => t.id !== tagId);
			await backpack.update({ "system.contents": contents });
			this._syncing = true;
			await this._syncContentsToEffects();
			this._syncing = false;
		}

		/**
		 * Update a tag in the backpack contents.
		 * @param {string} tagId
		 * @param {object} updateData - Partial update (e.g. { name: "new name" })
		 * @returns {Promise<void>}
		 */
		async updateTag(tagId, updateData) {
			const backpack = this._getBackpackItem();
			if (!backpack) return;

			const contents = backpack.system.toObject().contents;
			const entry = contents.find((t) => t.id === tagId);
			if (!entry) return;

			Object.assign(entry, updateData);
			await backpack.update({ "system.contents": contents });
			this._syncing = true;
			await this._syncContentsToEffects();
			this._syncing = false;
		}

		/**
		 * Toggle active state of a backpack tag.
		 * @param {string} tagId
		 * @returns {Promise<void>}
		 */
		async toggleTagActive(tagId) {
			const backpack = this._getBackpackItem();
			if (!backpack) return;

			const entry = backpack.system.contents.find((t) => t.id === tagId);
			if (!entry) return;

			return this.updateTag(tagId, { isActive: !entry.isActive });
		}

		/**
		 * Toggle scratched state of a backpack tag.
		 * @param {string} tagId
		 * @returns {Promise<void>}
		 */
		async toggleTagScratched(tagId) {
			const backpack = this._getBackpackItem();
			if (!backpack) return;

			const entry = backpack.system.contents.find((t) => t.id === tagId);
			if (!entry) return;

			return this.updateTag(tagId, { isScratched: !entry.isScratched });
		}
	};
}
