# Backpack Effect Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify backpack tags and story tags on hero actors by syncing backpack contents to transferred ActiveEffects, merging the two UI sections into one.

**Architecture:** A `BackpackSyncMixin` on the hero sheet synchronizes the backpack item's `contents` array (source of truth) to `story_tag` ActiveEffects on the backpack item with `transfer: true`. Hooks handle the reverse direction. Hero helper methods abstract tag routing so consumers don't need to know where tags live.

**Tech Stack:** Foundry VTT v13/v14 ApplicationV2, ActiveEffect transfer, TypeDataModel, Handlebars templates

**Spec:** `docs/superpowers/specs/2026-03-31-backpack-effect-sync-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `scripts/data/active-effect-data.js` | Modify | Add `isSuppressed` getter to `StoryTagData` |
| `scripts/sheets/backpack-sync-mixin.js` | Create | Bidirectional sync between backpack contents and transferred effects |
| `scripts/actor/hero/hero-sheet.js` | Modify | Apply `BackpackSyncMixin`, add helper methods, update roll tag builders, merge UI sections |
| `scripts/actor/hero/hero-data.js` | Modify | Update `storyTags` getter to use `allApplicableEffects()` |
| `scripts/sheets/base-actor-sheet.js` | Modify | Route hero tag drops to backpack helpers |
| `scripts/apps/story-tag-sidebar.js` | Modify | Use hero helpers for tag CRUD on hero actors |
| `templates/actor/hero.html` | Modify | Merge backpack + story tags into single section |
| `templates/actor/hero-play.html` | Modify | Merge backpack + story tags into single section |

---

### Task 1: Add `isSuppressed` getter to StoryTagData

**Files:**
- Modify: `scripts/data/active-effect-data.js:20-30`

This makes `effect.active` return `false` for scratched story tags, which means `actor.appliedEffects` only returns usable tags.

- [ ] **Step 1: Add the getter**

In `scripts/data/active-effect-data.js`, add a `get isSuppressed()` getter to the `StoryTagData` class, after the `static defineSchema()` method:

```javascript
get isSuppressed() {
	return this.isScratched;
}
```

- [ ] **Step 2: Verify no regressions**

Run: `cd tests/e2e && npx playwright test`

Scratched story tags should still display on sheets (they're visible but not `active`). The `appliedEffects` getter filters by `active`, but existing code uses `actor.effects` directly, so nothing should break yet.

- [ ] **Step 3: Commit**

```bash
git add scripts/data/active-effect-data.js
git commit -m "feat: add isSuppressed getter to StoryTagData for scratched tags"
```

---

### Task 2: Create BackpackSyncMixin

**Files:**
- Create: `scripts/sheets/backpack-sync-mixin.js`

This is the core sync mechanism, modeled on `TagStringSyncMixin` (`scripts/sheets/tag-string-sync-mixin.js`). It syncs the backpack item's `contents` array to ActiveEffects on the backpack item with `transfer: true`.

- [ ] **Step 1: Create the mixin file**

Create `scripts/sheets/backpack-sync-mixin.js`:

```javascript
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
```

- [ ] **Step 2: Commit**

```bash
git add scripts/sheets/backpack-sync-mixin.js
git commit -m "feat: create BackpackSyncMixin for backpack contents ↔ effects sync"
```

---

### Task 3: Apply BackpackSyncMixin to HeroSheet

**Files:**
- Modify: `scripts/actor/hero/hero-sheet.js:1-10` (class declaration and import)

- [ ] **Step 1: Add import and apply mixin**

At the top of `scripts/actor/hero/hero-sheet.js`, add the import:

```javascript
import { BackpackSyncMixin } from "../../sheets/backpack-sync-mixin.js";
```

Change the class declaration from:

```javascript
export class HeroSheet extends LitmActorSheet {
```

to:

```javascript
export class HeroSheet extends BackpackSyncMixin(LitmActorSheet) {
```

- [ ] **Step 2: Verify no regressions**

Run: `cd tests/e2e && npx playwright test`

The mixin should be transparent at this point — `_onFirstRender` will run the initial sync (creating effects from existing contents), but nothing consumes the effects yet.

- [ ] **Step 3: Commit**

```bash
git add scripts/actor/hero/hero-sheet.js
git commit -m "feat: apply BackpackSyncMixin to HeroSheet"
```

---

### Task 4: Update HeroData.storyTags to use allApplicableEffects

**Files:**
- Modify: `scripts/actor/hero/hero-data.js:166-181`

The `storyTags` getter currently reads from `this.parent.effects` (direct actor effects only). It needs to use `allApplicableEffects()` to also pick up transferred effects from the backpack item.

- [ ] **Step 1: Update the getter**

In `scripts/actor/hero/hero-data.js`, change the `storyTags` getter from:

```javascript
get storyTags() {
	return (this.parent.effects ?? [])
		.filter(
			(effect) => effect.system instanceof game.litmv2.data.StoryTagData,
		)
		.filter((effect) => game.user.isGM || !effect.system?.isHidden)
		.map((effect) => {
			return {
				id: effect._id,
				name: effect.name,
				type: "tag",
				isSingleUse: effect.system?.isSingleUse ?? false,
				value: 1, // Story tags are just 1
			};
		});
}
```

to:

```javascript
get storyTags() {
	const effects = [];
	for (const effect of this.parent.allApplicableEffects()) {
		if (!(effect.system instanceof game.litmv2.data.StoryTagData)) continue;
		effects.push(effect);
	}
	return effects
		.filter((effect) => game.user.isGM || !effect.system?.isHidden)
		.map((effect) => {
			return {
				id: effect._id,
				name: effect.name,
				type: "tag",
				isSingleUse: effect.system?.isSingleUse ?? false,
				value: 1,
			};
		});
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/actor/hero/hero-data.js
git commit -m "feat: use allApplicableEffects() in HeroData.storyTags getter"
```

---

### Task 5: Update _prepareStoryTags in base-actor-sheet

**Files:**
- Modify: `scripts/sheets/base-actor-sheet.js:388-406`

This method is used by the hero sheet to prepare story tags for template rendering. It currently reads `this.document.effects`. For heroes, it should use `allApplicableEffects()` to include transferred backpack effects.

- [ ] **Step 1: Update _prepareStoryTags**

In `scripts/sheets/base-actor-sheet.js`, change `_prepareStoryTags()` from:

```javascript
_prepareStoryTags() {
	const effects = this.document.effects ?? [];
	return effects
		.filter((e) => e.type === "story_tag" || e.type === "status_card")
		.filter((e) => game.user.isGM || !(e.system?.isHidden ?? false))
		.map((e) => {
			const isStatus = e.type === "status_card";
			return {
				id: e.id,
				name: e.name,
				type: isStatus ? "status" : "tag",
				effectType: e.type,
				value: isStatus ? (e.system?.currentTier ?? 0) : 1,
				isScratched: e.system?.isScratched ?? false,
				hidden: e.system?.isHidden ?? false,
				system: e.system,
			};
		});
}
```

to:

```javascript
_prepareStoryTags() {
	const effects = [];
	for (const e of this.document.allApplicableEffects()) {
		if (e.type === "story_tag" || e.type === "status_card") effects.push(e);
	}
	return effects
		.filter((e) => game.user.isGM || !(e.system?.isHidden ?? false))
		.map((e) => {
			const isStatus = e.type === "status_card";
			return {
				id: e.id,
				name: e.name,
				type: isStatus ? "status" : "tag",
				effectType: e.type,
				value: isStatus ? (e.system?.currentTier ?? 0) : 1,
				isScratched: e.system?.isScratched ?? false,
				hidden: e.system?.isHidden ?? false,
				system: e.system,
			};
		});
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/sheets/base-actor-sheet.js
git commit -m "feat: use allApplicableEffects() in _prepareStoryTags"
```

---

### Task 6: Route hero tag drops to backpack

**Files:**
- Modify: `scripts/sheets/base-actor-sheet.js:430-472` (`_onDropTagOrStatus`)
- Modify: `scripts/sheets/base-actor-sheet.js:498-516` (`_onAddStoryTag`)

When a tag (not a status) is dropped on a hero sheet, or a story tag is added via the UI, it should go to the backpack instead of creating a direct ActiveEffect.

- [ ] **Step 1: Update _onDropTagOrStatus**

In `scripts/sheets/base-actor-sheet.js`, update `_onDropTagOrStatus` to route tags to the backpack for hero actors. After the ownership/editability guard and the intra-sheet drop guard, add a hero routing block:

```javascript
async _onDropTagOrStatus(_event, data) {
	if (!this.document.isOwner || !this.isEditable) return;

	// Ignore drops from the same actor (intra-sheet drag is for sorting, not adding)
	if (data.sourceActorId && data.sourceActorId === this.document.id) return;

	const isStatus = data.type === "status";

	// For heroes, route tags (not statuses) to the backpack
	if (this.document.type === "hero" && !isStatus && this.addTag) {
		await this.addTag({
			name: data.name ?? game.i18n.localize("LITM.Terms.tag"),
			isActive: true,
			isScratched: data.isScratched ?? false,
			isSingleUse: data.isSingleUse ?? false,
		});
		this._notifyStoryTags();
		return;
	}

	const droppedName = data.name;

	// For statuses, check if one with the same name already exists and stack
	if (isStatus && droppedName) {
		const existing = this.document.effects.find(
			(e) =>
				e.type === "status_card" &&
				e.name.toLowerCase() === droppedName.toLowerCase(),
		);
		if (existing) {
			const droppedTier = Number.parseInt(data.value, 10) || 1;
			const newTiers = existing.system.calculateMark(droppedTier);
			await existing.update({ "system.tiers": newTiers });
			this._notifyStoryTags();
			return;
		}
	}

	const tiers = Array.isArray(data.values)
		? data.values.map(
				(value) => value !== null && value !== false && value !== "",
			)
		: new Array(6).fill(false);
	const isScratched = data.isScratched ?? false;
	const localizedName = isStatus
		? game.i18n.localize("LITM.Terms.status")
		: game.i18n.localize("LITM.Terms.tag");
	const effectData = {
		name: data.name ?? localizedName,
		type: isStatus ? "status_card" : "story_tag",
		system: isStatus ? { tiers } : { isScratched },
	};

	await this.document.createEmbeddedDocuments("ActiveEffect", [effectData]);
	this._notifyStoryTags();
}
```

- [ ] **Step 2: Update _onAddStoryTag**

In `scripts/sheets/base-actor-sheet.js`, update `_onAddStoryTag` to route tags to the backpack for heroes:

```javascript
static async _onAddStoryTag(_event, target) {
	const tagType = target.dataset.tagType || "tag";
	const isStatus = tagType === "status";

	// For heroes, route tags (not statuses) to the backpack
	if (this.document.type === "hero" && !isStatus && this.addTag) {
		return this.addTag({
			name: game.i18n.localize("LITM.Terms.tag"),
			isActive: true,
			isScratched: false,
			isSingleUse: false,
		});
	}

	const localizedName = isStatus
		? game.i18n.localize("LITM.Terms.status")
		: game.i18n.localize("LITM.Terms.tag");
	await this.document.createEmbeddedDocuments("ActiveEffect", [
		{
			name: localizedName,
			type: isStatus ? "status_card" : "story_tag",
			system: isStatus
				? { tiers: [false, false, false, false, false, false] }
				: { isSingleUse: false, isScratched: false },
		},
	]);

	this._notifyStoryTags();
}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/sheets/base-actor-sheet.js
git commit -m "feat: route hero tag drops and additions to backpack"
```

---

### Task 7: Update toggleScratchTag for backpack-synced tags

**Files:**
- Modify: `scripts/actor/hero/hero-sheet.js:644-723` (`toggleScratchTag`)

The existing `"backpack"` and `"tag"` cases in `toggleScratchTag` need updating. Backpack tags are now effects, so the roll dialog may send them with type `"tag"` (since they're `story_tag` ActiveEffects). The `"tag"` case needs to check if the effect is a backpack-synced effect and use the helper if so.

- [ ] **Step 1: Update the "tag" case in toggleScratchTag**

In `scripts/actor/hero/hero-sheet.js`, find the `toggleScratchTag` method. Update the `"tag"` case (around line 701) to handle backpack-synced effects:

```javascript
case "tag": {
	// Check if this is a transferred backpack effect
	const allEffects = [...this.document.allApplicableEffects()];
	const effect = allEffects.find(
		(e) => e.id === tag.id && e.type === "story_tag",
	);
	if (!effect) return;

	// If it has a contentsId, it's a backpack-synced effect — use the helper
	if (effect.getFlag("litmv2", "contentsId")) {
		const contentsId = effect.getFlag("litmv2", "contentsId");
		await this.toggleTagScratched(contentsId);
	} else {
		// Direct actor effect (legacy or non-backpack)
		const isScratched = effect.system?.isScratched ?? false;
		await effect.update({
			"system.isScratched": !isScratched,
		});
	}
	break;
}
```

- [ ] **Step 2: Remove the standalone "backpack" case**

The `"backpack"` case (around line 686-699) can be removed since backpack tags now go through the `"tag"` path as transferred effects. However, keep it for backwards compatibility during the transition — existing roll dialogs may still send `type: "backpack"`. Update it to use the helper:

```javascript
case "backpack": {
	await this.toggleTagScratched(tag.id);
	break;
}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/actor/hero/hero-sheet.js
git commit -m "feat: update toggleScratchTag to handle backpack-synced effects"
```

---

### Task 8: Update roll dialog tag builders

**Files:**
- Modify: `scripts/actor/hero/hero-sheet.js:379-401` (`_buildBackpackRollTags` and `_buildAllRollTags`)

Backpack tags are now transferred effects visible via `allApplicableEffects()`. The roll dialog should read them from effects rather than from `backpackItem.system.contents`. This consolidates the two separate tag sources.

- [ ] **Step 1: Rewrite _buildBackpackRollTags**

In `scripts/actor/hero/hero-sheet.js`, replace `_buildBackpackRollTags()`:

```javascript
_buildBackpackRollTags() {
	const backpack = this.document.items.find((i) => i.type === "backpack");
	if (!backpack) return [];

	return backpack.effects
		.filter((e) => e.type === "story_tag" && e.transfer)
		.filter((e) => !e.disabled && !e.system.isScratched)
		.map((e) => ({
			id: e.getFlag("litmv2", "contentsId") ?? e.id,
			name: e.name,
			displayName: e.name,
			themeId: backpack.id,
			themeName: backpack.name,
			type: "backpack",
			isSingleUse: e.system.isSingleUse ?? false,
			state: "",
			states: e.system.isSingleUse ? ",positive" : ",positive,scratched",
		}));
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/actor/hero/hero-sheet.js
git commit -m "feat: read backpack roll tags from transferred effects"
```

---

### Task 9: Update sidebar to use hero helpers

**Files:**
- Modify: `scripts/apps/story-tag-sidebar.js`

The sidebar needs to use the hero's helper methods (`addTag`, `removeTag`, `updateTag`) when operating on hero actors, instead of directly manipulating ActiveEffects.

- [ ] **Step 1: Update #addTagToActor**

In `scripts/apps/story-tag-sidebar.js`, find `#addTagToActor` (around line 1380). Add a hero-routing check at the top of the method, after the ownership checks:

```javascript
async #addTagToActor({ id, tag }) {
	const actor = game.actors.get(id);
	if (!actor) {
		return ui.notifications.error("LITM.Ui.error_no_actor", {
			localize: true,
		});
	}
	if (!actor.isOwner) {
		return ui.notifications.error("LITM.Ui.warn_not_owner", {
			localize: true,
		});
	}

	// For heroes, route tags (not statuses) through the backpack helper
	const hasValues = Array.isArray(tag.values)
		? tag.values.some((v) => v !== null && v !== false && v !== "")
		: false;
	const isStatus = tag.type === "status" || hasValues;

	if (actor.type === "hero" && !isStatus && actor.sheet?.addTag) {
		await actor.sheet.addTag({
			name: tag.name,
			isActive: true,
			isScratched: tag.isScratched ?? false,
			isSingleUse: tag.isSingleUse ?? false,
		});
		await this.#recalculateChallengeLimits(id);
		return this.#broadcastRender();
	}

	// Non-hero path: create effect directly on the actor (unchanged)
	const type = isStatus ? "status" : "tag";
	const tiers = Array.isArray(tag.values)
		? tag.values.map(
				(value) => value !== null && value !== false && value !== "",
			)
		: new Array(6).fill(false);

	const maxSort = Math.max(0, ...actor.effects.map((e) => e.sort ?? 0));
	const systemData =
		type === "status"
			? { tiers, isHidden: game.user.isGM }
			: {
					isScratched: tag.isScratched ?? false,
					isSingleUse: tag.isSingleUse ?? false,
					isHidden: game.user.isGM,
				};
	if (tag.limitId) systemData.limitId = tag.limitId;
	const [created] = await actor.createEmbeddedDocuments("ActiveEffect", [
		{
			name: tag.name,
			type: type === "status" ? "status_card" : "story_tag",
			sort: maxSort + 1000,
			system: systemData,
		},
	]);
	if (created) this._editOnRender = created.id;
	await this.#recalculateChallengeLimits(id);
	return this.#broadcastRender();
}
```

- [ ] **Step 2: Update onSubmit for hero actor effects**

In `scripts/apps/story-tag-sidebar.js`, the `onSubmit` method (around line 797) iterates actors and calls `#updateTagsOnActor` which does `actor.updateEmbeddedDocuments("ActiveEffect", tags)`. For hero actors, the effects live on the backpack item, not the actor directly. Update the actor iteration block (around line 822-852) to route hero updates through the backpack item:

Find the block that iterates over `actors` entries and builds the update array. Before calling `#updateTagsOnActor`, check if the actor is a hero:

```javascript
for (const [actorId, tags] of Object.entries(actors)) {
	const actor = game.actors.get(actorId);
	if (!actor?.isOwner) continue;

	const updates = Object.entries(tags).map(([effectId, data]) => {
		const isStatus = data.tagType === "status";
		return {
			_id: effectId,
			name: data.name,
			system: isStatus
				? {
						tiers: toTiers(data.values),
						isScratched: data.isScratched === "true",
					}
				: {
						isScratched: data.isScratched === "true",
						isSingleUse: data.isSingleUse === "true",
						limitId: data.limitId || null,
					},
		};
	});

	if (actor.type === "hero") {
		// Route story_tag updates through the backpack item
		const backpack = actor.items.find((i) => i.type === "backpack");
		const backpackEffectIds = new Set(
			backpack?.effects.map((e) => e.id) ?? [],
		);
		const backpackUpdates = updates.filter((u) =>
			backpackEffectIds.has(u._id),
		);
		const directUpdates = updates.filter(
			(u) => !backpackEffectIds.has(u._id),
		);
		if (backpackUpdates.length) {
			await backpack.updateEmbeddedDocuments(
				"ActiveEffect",
				backpackUpdates,
			);
		}
		if (directUpdates.length) {
			await this.#updateTagsOnActor({ id: actorId, tags: directUpdates });
		}
	} else {
		await this.#updateTagsOnActor({ id: actorId, tags: updates });
	}
}
```

- [ ] **Step 3: Update #removeTagFromActor for hero backpack effects**

In `scripts/apps/story-tag-sidebar.js`, find `#removeTagFromActor` (around line 1432). For hero actors, the effect lives on the backpack item, not the actor. Route the deletion:

```javascript
async #removeTagFromActor({ actorId, id }) {
	const actor = game.actors.get(actorId);

	if (!actor) {
		return ui.notifications.error("LITM.Ui.error_no_actor", {
			localize: true,
		});
	}
	if (!actor.isOwner) return;

	// For heroes, check if the effect is on the backpack item
	if (actor.type === "hero") {
		const backpack = actor.items.find((i) => i.type === "backpack");
		if (backpack?.effects.has(id)) {
			await backpack.deleteEmbeddedDocuments("ActiveEffect", [id]);
			await this.#recalculateChallengeLimits(actorId);
			return this.#broadcastRender();
		}
	}

	await actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
	await this.#recalculateChallengeLimits(actorId);
	return this.#broadcastRender();
}
```

- [ ] **Step 4: Update #removeFromSource for hero backpack effects**

In `scripts/apps/story-tag-sidebar.js`, find `#removeFromSource` (around line 1289). The actor branch checks `actor.effects.has(data.sourceId)` which won't find backpack-synced effects. Update:

```javascript
async #removeFromSource(data) {
	if (!data.sourceContainer || !data.sourceId) return;

	if (data.sourceContainer === "story") {
		const tags = this.config.tags.filter((t) => t.id !== data.sourceId);
		if (game.user.isGM) return this.setTags(tags);
		return this.#broadcastUpdate("tags", tags);
	}

	const actor = game.actors.get(data.sourceContainer);
	if (!actor?.isOwner) return;

	// Check backpack item for hero actors
	if (actor.type === "hero") {
		const backpack = actor.items.find((i) => i.type === "backpack");
		if (backpack?.effects.has(data.sourceId)) {
			await backpack.deleteEmbeddedDocuments("ActiveEffect", [data.sourceId]);
			return this.#broadcastRender();
		}
	}

	if (!actor.effects.has(data.sourceId)) return;
	await actor.deleteEmbeddedDocuments("ActiveEffect", [data.sourceId]);
	return this.#broadcastRender();
}
```

- [ ] **Step 5: Commit**

```bash
git add scripts/apps/story-tag-sidebar.js
git commit -m "feat: route sidebar tag operations through hero helpers"
```

---

### Task 10: Merge hero sheet templates

**Files:**
- Modify: `templates/actor/hero.html:219-308` (edit mode)
- Modify: `templates/actor/hero-play.html:169-252` (play mode)

Merge the "Backpack" and "Story Tags & Statuses" fieldsets into a single "Backpack" section. Statuses stay in their own sub-section.

- [ ] **Step 1: Update edit mode template**

In `templates/actor/hero.html`, replace the `grid-2col` div containing both the Backpack and Story Tags fieldsets (lines 219-308) with a merged section. The new section shows all tags (both former backpack contents and story tags) in one list, with statuses in a separate sub-section:

```handlebars
<!-- Backpack & Story Tags -->
{{#if backpack}}
<fieldset>
	<legend class="control flexrow gap-sm">
		<span class="litm-banner theme-card__book">{{backpack.name}}</span>
		<button type="button" class="noflex" data-action="editItem" data-item-id="{{backpack.id}}"
			data-tooltip="{{localize 'LITM.Ui.edit_backpack'}}" aria-label="{{localize 'LITM.Ui.edit_backpack'}}">
			<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>
		</button>
		<button type="button" class="noflex" data-action="addStoryTag" data-tag-type="tag"
			data-tooltip="{{localize 'LITM.Ui.add_tag'}}" aria-label="{{localize 'LITM.Ui.add_tag'}}">
			<i class="fa-solid fa-scroll" aria-hidden="true"></i>
		</button>
	</legend>

	{{#if backpack.contents.length}}
	<div class="theme-card-tags" data-item-id="{{backpack.id}}">
		{{#each backpack.contents as |tag|}}
		{{> systems/litmv2/templates/partials/play-tag.html tag
		action="toggleTagActive"
		tooltip=(localize "LITM.Ui.click_to_toggle_tag")
		extraClass=(ifThen tag.isActive "" "is-inactive")
		}}
		{{/each}}
	</div>
	{{else}}
	<p class="hint">{{localize "LITM.Ui.backpack_empty"}}</p>
	{{/if}}
</fieldset>
{{else}}
<div class="empty-state">
	<img height="64" width="64" src="systems/litmv2/assets/media/icons/backpack.svg" alt="" aria-hidden="true" />
	<p class="hint">{{localize "LITM.Ui.no_backpack"}}</p>
</div>
{{/if}}

<!-- Statuses -->
{{#if statuses.length}}
<fieldset>
	<legend class="control flexrow gap-sm">
		<span class="litm-banner theme-card__book">{{localize "LITM.Terms.statuses"}}</span>
		<button type="button" class="noflex" data-action="addStoryTag" data-tag-type="status"
			data-tooltip="{{localize 'LITM.Ui.add_status'}}" aria-label="{{localize 'LITM.Ui.add_status'}}">
			<i class="fa-solid fa-droplet" aria-hidden="true"></i>
		</button>
	</legend>
	<ul class="plain">
		{{#each statuses as |tag|}}
		<li class="form-group status" style="gap: 8px; align-items: center;justify-content: space-between;">
			<span class="litm--tag-name-wrapper litm-status">
				<input class="litm--tag-item-name" type="text" name="effects.{{tag.id}}.name" value="{{tag.name}}"
					placeholder="{{localize 'LITM.Ui.tag_name'}}" />
			</span>
			<div class="progress-display" style="flex: 0 0 auto;" data-id="system.tiers">
				{{#each tag.system.tiers as |checked|}}
				<button type="button" class="progress-box {{#if checked}}checked{{/if}}"
					data-action="adjustProgress" data-index="{{@index}}" data-effect-id="{{tag.id}}"
					aria-pressed="{{#if checked}}true{{else}}false{{/if}}">
					<img src="systems/litmv2/assets/media/checkbox{{ifThen checked '-c' ''}}.svg" alt="" aria-hidden="true" />
				</button>
				{{/each}}
			</div>
			<button type="button" style="flex:none;" data-action="removeEffect" data-id="{{tag.id}}"
				data-tooltip="{{localize 'LITM.Ui.remove'}} status"
				aria-label="{{localize 'LITM.Ui.remove'}} status">
				<i class="fa-solid fa-trash" aria-hidden="true"></i>
			</button>
		</li>
		{{/each}}
	</ul>
</fieldset>
{{/if}}
```

- [ ] **Step 2: Update _prepareContext to separate tags from statuses**

In `scripts/actor/hero/hero-sheet.js`, in `_prepareContext`, the current `storyTags` context variable contains both tags and statuses. Split it so the template can render them separately. Find where `storyTags` is assigned (around line 230) and add a `statuses` variable:

```javascript
const storyTags = this._prepareStoryTags();
const statuses = storyTags.filter((t) => t.type === "status");
const tagEffects = storyTags.filter((t) => t.type === "tag");
```

Then in the returned context object, replace the `storyTags` entry and add `statuses`:

```javascript
storyTags: tagEffects,
statuses,
```

Note: the `storyTags` variable in the context now only contains tags (not statuses). The backpack contents are shown from `backpack.contents` in the template. The `tagEffects` are still included for any story tags that might exist as direct effects (legacy data or edge cases).

- [ ] **Step 3: Update play mode template**

In `templates/actor/hero-play.html`, replace the `grid-2col` div containing both Backpack and Story Tags (lines 169-252) with a merged section:

```handlebars
<!-- Backpack -->
{{#if backpack}}
<fieldset>
	<legend class="flexrow gap-sm">
		<span class="litm-banner" style="font-size: var(--font-size-11);">{{backpack.name}}</span>
		<button type="button" class="noflex" data-action="editItem" data-item-id="{{backpack.id}}"
			data-tooltip="{{localize 'LITM.Ui.edit_backpack'}}" aria-label="{{localize 'LITM.Ui.edit_backpack'}}">
			<i class="fa-solid fa-pen-to-square" aria-hidden="true"></i>
		</button>
	</legend>

	{{#if backpack.contents.length}}
	<div class="flexrow gap-sm" style="flex-wrap: wrap;">
		{{#each backpack.contents as |tag|}} {{#if tag.isActive}}
		<span class="noflex litm-tag {{ifThen tag.isScratched 'scratched' ''}}"
			{{#if @root.isOwner}}data-action="selectTag" {{/if}} data-tag-type="backpack" data-tag-id="{{tag.id}}" {{#if
			@root.isOwner}}data-tooltip="{{localize 'LITM.Ui.click_to_add_tag_no_burn'}}" {{/if}} data-text="{{tag.name}}"
			{{#if @root.isOwner}}style="cursor: pointer" {{/if}}>
			{{tag.name}} {{#if tag.isScratched}}
			<svg width="18" height="18" viewBox="0 0 128 128" fill="none" xmlns="http://www.w3.org/2000/svg">
				<g fill="var(--color-text-primary)" stroke="var(--tag-color)" stroke-width="4">
					<path
						d="M20 20L108 108M20 108L108 20"
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="22" />
				</g>
			</svg>
			{{/if}}
		</span>
		{{/if}} {{/each}}
	</div>
	{{else}}
	<p class="hint">{{localize "LITM.Ui.backpack_empty"}}</p>
	{{/if}}
</fieldset>
{{else}}
<div class="empty-state">
	<img height="64" width="64" src="systems/litmv2/assets/media/icons/backpack.svg" alt="" aria-hidden="true" />
	<p class="hint">{{localize "LITM.Ui.no_backpack"}}</p>
</div>
{{/if}}

<!-- Statuses -->
{{#if statuses.length}}
<fieldset class="litm--receded">
	<legend class="litm-banner theme-card__book">
		{{localize "LITM.Terms.statuses"}}
	</legend>
	<div class="litm--play-tags">
		{{#each statuses as |tag|}}
		<span class="litm-status{{#if tag.hidden}} litm--tag-hidden{{/if}}" {{#if @root.isOwner}}data-action="selectTag"
			{{/if}} data-tag-type="{{tag.type}}" data-tag-id="{{tag.id}}" {{#if
			@root.isOwner}}data-tooltip="{{localize 'LITM.Ui.click_to_add_tag_only'}}" {{/if}}
			data-text="{{tag.name}}-{{tag.value}}" {{#if @root.isOwner}}style="cursor: pointer"
			{{/if}}>{{tag.name}}-{{tag.value}}</span>
		{{/each}}
	</div>
</fieldset>
{{/if}}
```

- [ ] **Step 4: Update play mode _prepareContext**

Ensure the play mode context also provides `statuses` separately. The `_prepareContext` changes from Step 2 already handle this since both edit and play modes use the same `_prepareContext` method.

- [ ] **Step 5: Add "LITM.Terms.statuses" localization key**

In `lang/en.json`, add the key if it doesn't exist. Check first:

```bash
grep -c "statuses" lang/en.json
```

If missing, add `"statuses": "Statuses"` under the `LITM.Terms` section.

- [ ] **Step 6: Commit**

```bash
git add templates/actor/hero.html templates/actor/hero-play.html scripts/actor/hero/hero-sheet.js lang/en.json
git commit -m "feat: merge backpack and story tags into single section on hero sheet"
```

---

### Task 11: Clean up _updateEmbeddedFromForm for hero effects

**Files:**
- Modify: `scripts/sheets/base-actor-sheet.js` (`_updateEmbeddedFromForm`)

The form submit handler parses `effects.*` keys and updates them on the actor. For heroes with backpack-synced effects, these updates need to route to the backpack item. Check how `_updateEmbeddedFromForm` works and update if needed.

- [ ] **Step 1: Read the current implementation**

Read `scripts/sheets/base-actor-sheet.js` and find `_updateEmbeddedFromForm` or `_onSubmitActorForm`. Understand how it processes `effects.*` form keys.

- [ ] **Step 2: Add hero routing to the submit handler**

In the method that processes `effects.*` form data, add a check: if the actor is a hero and the effect exists on the backpack item (not on the actor directly), route the update through the backpack item:

```javascript
// Inside the effects update section of _updateEmbeddedFromForm:
if (this.document.type === "hero") {
	const backpack = this.document.items.find((i) => i.type === "backpack");
	if (backpack) {
		const backpackEffectIds = new Set(backpack.effects.map((e) => e.id));
		const backpackUpdates = effectUpdates.filter((u) =>
			backpackEffectIds.has(u._id),
		);
		const directUpdates = effectUpdates.filter(
			(u) => !backpackEffectIds.has(u._id),
		);
		if (backpackUpdates.length) {
			await backpack.updateEmbeddedDocuments("ActiveEffect", backpackUpdates);
		}
		if (directUpdates.length) {
			await this.document.updateEmbeddedDocuments("ActiveEffect", directUpdates);
		}
	} else {
		await this.document.updateEmbeddedDocuments("ActiveEffect", effectUpdates);
	}
} else {
	await this.document.updateEmbeddedDocuments("ActiveEffect", effectUpdates);
}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/sheets/base-actor-sheet.js
git commit -m "feat: route hero effect form updates through backpack item"
```

---

### Task 12: End-to-end verification

**Files:** None (testing only)

- [ ] **Step 1: Run E2E tests**

```bash
cd tests/e2e && npx playwright test
```

All existing tests should pass.

- [ ] **Step 2: Manual verification checklist**

Test in a running Foundry instance:

1. Open a hero sheet — backpack section should show tags from backpack contents
2. The old "Story Tags & Statuses" section should be gone; statuses appear in their own section
3. Add a tag via the hero sheet's add button — it should appear in the backpack
4. Drop a tag from a journal entry onto the hero sheet — it should go to the backpack
5. Open the story tag sidebar — hero's backpack tags should appear as effects
6. Rename a tag in the sidebar — the backpack contents should update
7. Scratch a tag via the roll dialog — the backpack contents should update
8. Toggle active/inactive on a backpack tag in edit mode — it should appear/disappear in play mode
9. Add a status to the hero — it should appear in the separate statuses section
10. Drop a tag on a challenge — it should still create a direct ActiveEffect (not routed to backpack)

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during manual verification"
```
