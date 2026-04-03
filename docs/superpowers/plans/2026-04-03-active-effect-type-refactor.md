# Active Effect Type System Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the 3-type Active Effect system (`theme_tag`, `story_tag`, `status_card`) into a 6-type system (`power_tag`, `weakness_tag`, `fellowship_tag`, `relationship_tag`, `story_tag`, `status_tag`) with computed getters, self-routing mutations, and ephemeral AE support.

**Architecture:** Each of the 6 AE types gets its own `TypeDataModel` subclass with a shared computed interface (`isStatus`, `canBurn`, `allowedStates`, `defaultPolarity`, `toggleScratch`). The old `ThemeTagData` splits into `PowerTagData` + `WeaknessTagData` + `FellowshipTagData`. `StatusCardData` becomes `StatusTagData`. Relationship tags move from plain `HeroData.relationships` array to `relationship_tag` AEs on the hero actor. The migration replaces the existing v1 migration (unused in production). Factory functions and all 26 consumer files update to the new type names.

**Tech Stack:** FoundryVTT v14, ES modules, Handlebars templates, Playwright E2E tests

**Spec:** `SYSTEM.md` (in repo root)

---

## File Map

### Files to Create
- `scripts/data/active-effects/power-tag-data.js` — `PowerTagData` TypeDataModel
- `scripts/data/active-effects/weakness-tag-data.js` — `WeaknessTagData` TypeDataModel
- `scripts/data/active-effects/fellowship-tag-data.js` — `FellowshipTagData` TypeDataModel
- `scripts/data/active-effects/relationship-tag-data.js` — `RelationshipTagData` TypeDataModel
- `scripts/data/active-effects/story-tag-data.js` — `StoryTagData` TypeDataModel (refactored from old)
- `scripts/data/active-effects/status-tag-data.js` — `StatusTagData` TypeDataModel (renamed from StatusCardData)
- `scripts/data/active-effects/index.js` — barrel export for all 6 types

### Files to Modify
- `scripts/data/active-effect-data.js` — **Delete** (replaced by individual files)
- `scripts/data/tag-data.js` — **Delete** (superseded by AE types)
- `scripts/utils.js` — Replace factory functions + remove `effectToTag`
- `scripts/system/config.js` — Add `BURN_POWER` constant
- `scripts/system/migrations.js` — Replace v1 migration with new 6-type migration
- `scripts/actor/effect-tags-mixin.js` — Update type string references
- `scripts/actor/hero/hero-data.js` — Replace `toggleScratchTag`, `rollableTags`, `effectTags`, `scratchedTags`; migrate `relationships` schema to relationship_tag AEs
- `scripts/actor/fellowship/fellowship-data.js` — Replace `scratchTag` with AE-based approach
- `scripts/item/theme/theme-data.js` — Update type filters, remove `effectToTag` usage
- `scripts/item/story-theme/story-theme-data.js` — Update type filters
- `scripts/item/backpack/backpack-data.js` — Update type filters
- `scripts/item/theme/theme-sheet.js` — Use new factory functions
- `scripts/item/story-theme/story-theme-sheet.js` — Use new factory functions
- `scripts/item/backpack/backpack-sheet.js` — Use new factory functions
- `scripts/sheets/base-actor-sheet.js` — Update type references, use `isStatus` getter
- `scripts/sheets/tag-string-sync-mixin.js` — Update type strings
- `scripts/apps/roll-dialog.js` — Use `allowedStates`, `isStatus` from data models
- `scripts/apps/roll.js` — Use `BURN_POWER` constant, `isStatus` getter
- `scripts/apps/spend-power.js` — Update type references
- `scripts/apps/theme-advancement.js` — Use new factory functions
- `scripts/apps/story-tag-sidebar.js` — Use `isStatus` getter, ephemeral AE pattern
- `scripts/system/hooks/actor-hooks.js` — Update validation hooks for new types
- `scripts/system/hooks/item-hooks.js` — Update addon sync for new type names
- `scripts/system/hooks/chat-hooks.js` — Update type references
- `scripts/system/sample-hero.js` — Update type references
- `scripts/system/build-packs.js` — Update type references
- `scripts/apps/welcome-overlay.js` — Update type references
- `scripts/item/vignette/vignette-sheet.js` — Update type references
- `scripts/item/litm-item.js` — Update type references
- `scripts/actor/hero/hero-sheet.js` — Remove scratch dispatch duplication, use `toggleScratch()`
- `scripts/actor/fellowship/fellowship-sheet.js` — Update type references
- `scripts/actor/challenge/challenge-sheet.js` — Update type references
- `litmv2.js` — Update imports and `CONFIG.ActiveEffect.dataModels` registration

---

## Task 1: Create the 6 AE Data Models

**Files:**
- Create: `scripts/data/active-effects/power-tag-data.js`
- Create: `scripts/data/active-effects/weakness-tag-data.js`
- Create: `scripts/data/active-effects/fellowship-tag-data.js`
- Create: `scripts/data/active-effects/relationship-tag-data.js`
- Create: `scripts/data/active-effects/story-tag-data.js`
- Create: `scripts/data/active-effects/status-tag-data.js`
- Create: `scripts/data/active-effects/index.js`

- [ ] **Step 1: Create `PowerTagData`**

```js
// scripts/data/active-effects/power-tag-data.js
export class PowerTagData extends foundry.data.ActiveEffectTypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			question: new fields.StringField({ initial: null, nullable: true, blank: true }),
			isScratched: new fields.BooleanField({ initial: false }),
		};
	}

	get isSuppressed() {
		return this.isScratched;
	}

	get isStatus() {
		return false;
	}

	get canBurn() {
		return !this.isScratched;
	}

	get allowedStates() {
		return ",positive,scratched";
	}

	get defaultPolarity() {
		return 1;
	}

	async toggleScratch() {
		return this.parent.update({ "system.isScratched": !this.isScratched });
	}
}
```

- [ ] **Step 2: Create `WeaknessTagData`**

```js
// scripts/data/active-effects/weakness-tag-data.js
export class WeaknessTagData extends foundry.data.ActiveEffectTypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			question: new fields.StringField({ initial: null, nullable: true, blank: true }),
		};
	}

	get isStatus() {
		return false;
	}

	get canBurn() {
		return false;
	}

	get allowedStates() {
		return ",negative,positive";
	}

	get defaultPolarity() {
		return -1;
	}
}
```

- [ ] **Step 3: Create `FellowshipTagData`**

```js
// scripts/data/active-effects/fellowship-tag-data.js
export class FellowshipTagData extends foundry.data.ActiveEffectTypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			question: new fields.StringField({ initial: null, nullable: true, blank: true }),
			isScratched: new fields.BooleanField({ initial: false }),
		};
	}

	get isSuppressed() {
		return this.isScratched;
	}

	get isStatus() {
		return false;
	}

	get canBurn() {
		return false;
	}

	get allowedStates() {
		return ",positive,negative";
	}

	get defaultPolarity() {
		return 1;
	}

	async toggleScratch() {
		return this.parent.update({ "system.isScratched": !this.isScratched });
	}
}
```

- [ ] **Step 4: Create `RelationshipTagData`**

```js
// scripts/data/active-effects/relationship-tag-data.js
export class RelationshipTagData extends foundry.data.ActiveEffectTypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			targetId: new fields.StringField({ initial: "", nullable: false }),
			isScratched: new fields.BooleanField({ initial: false }),
		};
	}

	get isSuppressed() {
		return this.isScratched;
	}

	get isStatus() {
		return false;
	}

	get canBurn() {
		return false;
	}

	get allowedStates() {
		return ",positive";
	}

	get defaultPolarity() {
		return 1;
	}

	async toggleScratch() {
		return this.parent.update({ "system.isScratched": !this.isScratched });
	}
}
```

- [ ] **Step 5: Create `StoryTagData`**

```js
// scripts/data/active-effects/story-tag-data.js
export class StoryTagData extends foundry.data.ActiveEffectTypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			isScratched: new fields.BooleanField({ initial: false }),
			isSingleUse: new fields.BooleanField({ initial: false }),
			isHidden: new fields.BooleanField({ initial: false }),
			limitId: new fields.StringField({ initial: null, nullable: true }),
		};
	}

	get isSuppressed() {
		return this.isScratched;
	}

	get isStatus() {
		return false;
	}

	get canBurn() {
		return !this.isSingleUse && !this.isScratched;
	}

	get allowedStates() {
		return this.isSingleUse ? ",positive,negative" : ",positive,negative,scratched";
	}

	get defaultPolarity() {
		return null;
	}

	async toggleScratch() {
		return this.parent.update({ "system.isScratched": !this.isScratched });
	}
}
```

- [ ] **Step 6: Create `StatusTagData`**

```js
// scripts/data/active-effects/status-tag-data.js
export class StatusTagData extends foundry.data.ActiveEffectTypeDataModel {
	static defineSchema() {
		const fields = foundry.data.fields;
		return {
			...super.defineSchema(),
			isHidden: new fields.BooleanField({ initial: false }),
			tiers: new fields.ArrayField(new fields.BooleanField(), {
				initial: [false, false, false, false, false, false],
				validate: (tiers) => {
					if (tiers.length !== 6)
						throw new foundry.data.validation.DataModelValidationError(
							`tiers must have exactly 6 entries, got ${tiers.length}`,
						);
				},
			}),
			limitId: new fields.StringField({ initial: null, nullable: true }),
		};
	}

	get isStatus() {
		return true;
	}

	get canBurn() {
		return false;
	}

	get allowedStates() {
		return ",positive,negative";
	}

	get defaultPolarity() {
		return null;
	}

	get currentTier() {
		const lastIndex = this.tiers.lastIndexOf(true);
		return lastIndex === -1 ? 0 : lastIndex + 1;
	}

	get value() {
		return this.currentTier;
	}

	static markTier(tiers, tier) {
		const index = tier - 1;
		if (index < 0 || index >= 6) return [...tiers];
		const newTiers = [...tiers];
		if (!newTiers[index]) {
			newTiers[index] = true;
		} else {
			for (let i = index + 1; i < 6; i++) {
				if (!newTiers[i]) {
					newTiers[i] = true;
					break;
				}
			}
		}
		return newTiers;
	}

	static stackTiers(tierArrays) {
		let combined = [false, false, false, false, false, false];
		for (const tiers of tierArrays) {
			for (let i = 0; i < 6; i++) {
				if (tiers[i]) {
					combined = StatusTagData.markTier(combined, i + 1);
				}
			}
		}
		const lastIndex = combined.lastIndexOf(true);
		return lastIndex === -1 ? 0 : lastIndex + 1;
	}

	calculateMark(tier) {
		return StatusTagData.markTier(this.tiers, tier);
	}

	calculateReduction(amount) {
		const newTiers = Array(6).fill(false);
		for (let i = 0; i < 6; i++) {
			if (this.tiers[i]) {
				const newIndex = i - amount;
				if (newIndex >= 0) newTiers[newIndex] = true;
			}
		}
		return newTiers;
	}
}
```

- [ ] **Step 7: Create barrel export**

```js
// scripts/data/active-effects/index.js
export { PowerTagData } from "./power-tag-data.js";
export { WeaknessTagData } from "./weakness-tag-data.js";
export { FellowshipTagData } from "./fellowship-tag-data.js";
export { RelationshipTagData } from "./relationship-tag-data.js";
export { StoryTagData } from "./story-tag-data.js";
export { StatusTagData } from "./status-tag-data.js";
```

- [ ] **Step 8: Commit**

```bash
git add scripts/data/active-effects/
git commit -m "feat: create 6 AE type data models with shared computed interface"
```

---

## Task 2: Register New Types and Update Entry Point

**Files:**
- Modify: `litmv2.js`
- Modify: `scripts/system/config.js`
- Delete: `scripts/data/active-effect-data.js`
- Delete: `scripts/data/tag-data.js`

- [ ] **Step 1: Update `litmv2.js` imports and registration**

Replace the old import block:
```js
import {
	StatusCardData,
	StoryTagData,
	ThemeTagData,
} from "./scripts/data/active-effect-data.js";
import { TagData } from "./scripts/data/tag-data.js";
```

With:
```js
import {
	PowerTagData,
	WeaknessTagData,
	FellowshipTagData,
	RelationshipTagData,
	StoryTagData,
	StatusTagData,
} from "./scripts/data/active-effects/index.js";
```

Replace the CONFIG registration (lines 106-108):
```js
CONFIG.ActiveEffect.dataModels.story_tag = StoryTagData;
CONFIG.ActiveEffect.dataModels.status_card = StatusCardData;
CONFIG.ActiveEffect.dataModels.theme_tag = ThemeTagData;
```

With:
```js
CONFIG.ActiveEffect.dataModels.power_tag = PowerTagData;
CONFIG.ActiveEffect.dataModels.weakness_tag = WeaknessTagData;
CONFIG.ActiveEffect.dataModels.fellowship_tag = FellowshipTagData;
CONFIG.ActiveEffect.dataModels.relationship_tag = RelationshipTagData;
CONFIG.ActiveEffect.dataModels.story_tag = StoryTagData;
CONFIG.ActiveEffect.dataModels.status_tag = StatusTagData;
```

Update the `game.litmv2.data` object (lines 65-70):
```js
data: {
	PowerTagData,
	WeaknessTagData,
	FellowshipTagData,
	RelationshipTagData,
	StoryTagData,
	StatusTagData,
},
```

- [ ] **Step 2: Add `BURN_POWER` to `LitmConfig`**

In `scripts/system/config.js`, add at the top of the class:
```js
static BURN_POWER = 3;
```

- [ ] **Step 3: Delete old files**

```bash
rm scripts/data/active-effect-data.js scripts/data/tag-data.js
```

- [ ] **Step 4: Commit**

```bash
git add litmv2.js scripts/system/config.js scripts/data/
git commit -m "feat: register 6 AE types, add BURN_POWER, remove old data models"
```

---

## Task 3: Update Factory Functions and Utils

**Files:**
- Modify: `scripts/utils.js`

- [ ] **Step 1: Replace factory functions and remove `effectToTag`**

Remove: `effectToTag`, `themeTagEffect`, `storyTagEffect`, `statusCardEffect`

Add these replacements:

```js
/**
 * Build ActiveEffect creation data for a power_tag effect.
 * @param {object} options
 * @param {string} options.name
 * @param {boolean} [options.isActive=false]
 * @param {string|null} [options.question=null]
 * @param {boolean} [options.isScratched=false]
 * @returns {object} Effect creation data
 */
export function powerTagEffect({
	name = "",
	isActive = false,
	question = null,
	isScratched = false,
} = {}) {
	return {
		name,
		type: "power_tag",
		disabled: !isActive,
		system: { question, isScratched },
	};
}

/**
 * Build ActiveEffect creation data for a weakness_tag effect.
 * @param {object} options
 * @param {string} options.name
 * @param {boolean} [options.isActive=false]
 * @param {string|null} [options.question=null]
 * @returns {object} Effect creation data
 */
export function weaknessTagEffect({
	name = "",
	isActive = false,
	question = null,
} = {}) {
	return {
		name,
		type: "weakness_tag",
		disabled: !isActive,
		system: { question },
	};
}

/**
 * Build ActiveEffect creation data for a fellowship_tag effect.
 * @param {object} options
 * @param {string} options.name
 * @param {boolean} [options.isActive=false]
 * @param {string|null} [options.question=null]
 * @param {boolean} [options.isScratched=false]
 * @returns {object} Effect creation data
 */
export function fellowshipTagEffect({
	name = "",
	isActive = false,
	question = null,
	isScratched = false,
} = {}) {
	return {
		name,
		type: "fellowship_tag",
		disabled: !isActive,
		system: { question, isScratched },
	};
}

/**
 * Build ActiveEffect creation data for a relationship_tag effect.
 * @param {object} options
 * @param {string} options.name
 * @param {string} options.targetId
 * @returns {object} Effect creation data
 */
export function relationshipTagEffect({
	name = "",
	targetId = "",
} = {}) {
	return {
		name,
		type: "relationship_tag",
		system: { targetId },
	};
}

/**
 * Build ActiveEffect creation data for a story_tag effect.
 * Callers add `transfer: true` at the call site when routing through a backpack.
 * @param {object} options
 * @param {string} options.name
 * @param {boolean} [options.isScratched=false]
 * @param {boolean} [options.isSingleUse=false]
 * @param {boolean} [options.isHidden=false]
 * @param {string|null} [options.limitId=null]
 * @returns {object} Effect creation data
 */
export function storyTagEffect({
	name = "",
	isScratched = false,
	isSingleUse = false,
	isHidden = false,
	limitId = null,
} = {}) {
	return {
		name,
		type: "story_tag",
		system: { isScratched, isSingleUse, isHidden, limitId },
	};
}

/**
 * Build ActiveEffect creation data for a status_tag effect.
 * @param {object} options
 * @param {string} options.name
 * @param {boolean[]} [options.tiers]
 * @param {boolean} [options.isHidden=false]
 * @param {string|null} [options.limitId=null]
 * @returns {object} Effect creation data
 */
export function statusTagEffect({
	name = "",
	tiers = [false, false, false, false, false, false],
	isHidden = false,
	limitId = null,
} = {}) {
	return {
		name,
		type: "status_tag",
		system: { tiers, isHidden, limitId },
	};
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/utils.js
git commit -m "feat: replace factory functions with 6-type versions, remove effectToTag"
```

---

## Task 4: Update the Migration

**Files:**
- Modify: `scripts/system/migrations.js`

- [ ] **Step 1: Rewrite the v1 migration for the new type system**

The existing v1 migration is unused in production (only tested once in a test world). Replace it entirely:

```js
import { error, info } from "../logger.js";
import { localize as t } from "../utils.js";
import { LitmSettings } from "./settings.js";

/**
 * Migrate a single item's legacy tag arrays to typed ActiveEffects.
 * Handles both pre-AE legacy data (powerTags/weaknessTags arrays) and
 * the intermediate AE format (theme_tag with tagType field, status_card).
 * @param {Item} item
 */
async function _migrateItemTags(item) {
	if (item.type === "theme" || item.type === "story_theme") {
		// Skip if already migrated to new types
		if (item.effects.some((e) => e.type === "power_tag" || e.type === "weakness_tag" || e.type === "fellowship_tag")) return;

		const isFellowship = item.system?.isFellowship ?? false;
		const powerType = isFellowship ? "fellowship_tag" : "power_tag";

		// Handle intermediate AE format (theme_tag effects)
		const existingThemeTags = item.effects.filter((e) => e.type === "theme_tag");
		if (existingThemeTags.length) {
			const updates = existingThemeTags.map((e) => ({
				_id: e.id,
				type: e.system.tagType === "weaknessTag" ? "weakness_tag" : powerType,
				system: {
					question: e.system.question ?? null,
					...(e.system.tagType !== "weaknessTag" ? { isScratched: e.system.isScratched ?? false } : {}),
				},
			}));
			await item.updateEmbeddedDocuments("ActiveEffect", updates);
			return;
		}

		// Handle pre-AE legacy arrays
		const sys = item._source?.system ?? {};
		const isStory = item.type === "story_theme";
		const power = isStory
			? (sys.theme?.powerTags ?? sys.powerTags ?? [])
			: (sys.powerTags ?? []);
		const weakness = isStory
			? (sys.theme?.weaknessTags ?? sys.weaknessTags ?? [])
			: (sys.weaknessTags ?? []);
		const effects = [
			...power.map((t) => ({
				name: t.name || "",
				type: powerType,
				disabled: !(t.isActive ?? false),
				system: { question: t.question ?? null, isScratched: t.isScratched ?? false },
			})),
			...weakness.map((t) => ({
				name: t.name || "",
				type: "weakness_tag",
				disabled: !(t.isActive ?? false),
				system: { question: t.question ?? null },
			})),
		];
		if (effects.length) {
			await item.createEmbeddedDocuments("ActiveEffect", effects);
		}
	}

	if (item.type === "backpack") {
		// Skip if already migrated
		if (item.effects.some((e) => e.type === "story_tag")) return;
		const contents = item._source?.system?.contents ?? [];
		if (!contents.length) return;
		await item.createEmbeddedDocuments("ActiveEffect", contents.map((t) => ({
			name: t.name || "",
			type: "story_tag",
			transfer: true,
			disabled: !(t.isActive ?? true),
			system: {
				isScratched: t.isScratched ?? false,
				isSingleUse: t.isSingleUse ?? false,
				isHidden: false,
			},
		})));
		await item.update({ "system.-=contents": null });
	}
}

/**
 * Migrate status_card effects to status_tag on an actor.
 * @param {Actor} actor
 */
async function _migrateActorEffects(actor) {
	const statusCards = actor.effects.filter((e) => e.type === "status_card");
	if (!statusCards.length) return;
	const updates = statusCards.map((e) => ({ _id: e.id, type: "status_tag" }));
	await actor.updateEmbeddedDocuments("ActiveEffect", updates);
}

/**
 * Migrate relationship data from HeroData.system.relationships array
 * to relationship_tag ActiveEffects on the hero actor.
 * @param {Actor} actor
 */
async function _migrateRelationships(actor) {
	if (actor.type !== "hero") return;
	if (actor.effects.some((e) => e.type === "relationship_tag")) return;

	const relationships = actor._source?.system?.relationships ?? [];
	if (!relationships.length) return;

	const effects = relationships
		.filter((r) => r.tag && r.actorId)
		.map((r) => ({
			name: r.tag,
			type: "relationship_tag",
			system: { targetId: r.actorId, isScratched: r.isScratched ?? false },
		}));

	if (effects.length) {
		await actor.createEmbeddedDocuments("ActiveEffect", effects);
	}
}

const MIGRATIONS = [
	{
		version: 1,
		migrate: async () => {
			// World actors: items + actor-level effects + relationships
			for (const actor of game.actors) {
				for (const item of actor.items) {
					try { await _migrateItemTags(item); }
					catch (err) { error(`Migration: ${item.uuid}`, err); }
				}
				try { await _migrateActorEffects(actor); }
				catch (err) { error(`Migration: ${actor.uuid} effects`, err); }
				try { await _migrateRelationships(actor); }
				catch (err) { error(`Migration: ${actor.uuid} relationships`, err); }
			}

			// Standalone world items
			for (const item of game.items) {
				try { await _migrateItemTags(item); }
				catch (err) { error(`Migration: ${item.uuid}`, err); }
			}

			// Compendium packs
			for (const pack of game.packs.filter((p) =>
				p.metadata.system === "litmv2" &&
				(p.documentName === "Actor" || p.documentName === "Item")
			)) {
				const docs = await pack.getDocuments();
				for (const doc of docs) {
					if (doc.documentName === "Actor") {
						for (const item of doc.items) {
							try { await _migrateItemTags(item); }
							catch (err) { error(`Migration: ${item.uuid}`, err); }
						}
						try { await _migrateActorEffects(doc); }
						catch (err) { error(`Migration: ${doc.uuid} effects`, err); }
						try { await _migrateRelationships(doc); }
						catch (err) { error(`Migration: ${doc.uuid} relationships`, err); }
					} else {
						try { await _migrateItemTags(doc); }
						catch (err) { error(`Migration: ${doc.uuid}`, err); }
					}
				}
			}
		},
	},
];

// ... migrateWorld function stays unchanged
```

- [ ] **Step 2: Commit**

```bash
git add scripts/system/migrations.js
git commit -m "feat: rewrite v1 migration for 6-type AE system"
```

---

## Task 5: Update Validation Hooks

**Files:**
- Modify: `scripts/system/hooks/actor-hooks.js`

- [ ] **Step 1: Update `_setStatusCardIcon` → `_setStatusTagIcon`**

Change the function and its hook:
```js
function _setStatusTagIcon() {
	Hooks.on("preCreateActiveEffect", (effect) => {
		if (effect.type !== "status_tag") return;
		effect.updateSource({
			img: "systems/litmv2/assets/media/icons/consequences.svg",
			showIcon: foundry.CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
		});
	});
}
```

- [ ] **Step 2: Update `_validateEffectType` for new types**

```js
function _validateEffectType() {
	Hooks.on("preCreateActiveEffect", (effect) => {
		const themeTagTypes = new Set(["power_tag", "weakness_tag", "fellowship_tag"]);
		if (!themeTagTypes.has(effect.type)) return;
		const parent = effect.parent;
		if (parent?.documentName === "Item" && ["theme", "story_theme"].includes(parent.type)) return;
		ui.notifications.warn("LITM.Ui.warn_invalid_effect_target", { localize: true });
		return false;
	});
}
```

- [ ] **Step 3: Update function name in the registration call**

Find where `_setStatusCardIcon` is called and rename to `_setStatusTagIcon`.

- [ ] **Step 4: Commit**

```bash
git add scripts/system/hooks/actor-hooks.js
git commit -m "refactor: update AE validation hooks for new type names"
```

---

## Task 6: Update EffectTagsMixin and Theme/Backpack Data

**Files:**
- Modify: `scripts/actor/effect-tags-mixin.js`
- Modify: `scripts/item/theme/theme-data.js`
- Modify: `scripts/item/story-theme/story-theme-data.js`
- Modify: `scripts/item/backpack/backpack-data.js`

- [ ] **Step 1: Update `EffectTagsMixin` type references**

```js
export function EffectTagsMixin(Base) {
	return class extends Base {
		get effectTags() {
			const effects = [];
			for (const effect of this.parent.allApplicableEffects()) {
				if (effect.system?.isStatus || effect.type === "story_tag" || effect.type === "relationship_tag") {
					effects.push(effect);
				}
			}
			return effects;
		}

		get statuses() {
			return this.effectTags
				.filter((e) => e.system?.isStatus)
				.filter((e) => game.user.isGM || !e.system?.isHidden)
				.map((e) => ({
					id: e._id,
					name: e.name,
					type: "status",
					value: e.system.currentTier,
				}));
		}

		get storyTags() {
			return this.effectTags
				.filter((e) => e.type === "story_tag")
				.filter((e) => game.user.isGM || !e.system?.isHidden)
				.map((e) => ({
					id: e._id,
					name: e.name,
					type: "tag",
					isSingleUse: e.system?.isSingleUse ?? false,
					value: 1,
				}));
		}
	};
}
```

- [ ] **Step 2: Update `ThemeData` tag getters**

In `scripts/item/theme/theme-data.js`, replace the tag getters. Remove the `effectToTag` import. Read effects directly:

```js
get powerTags() {
	return this.parent.effects
		.filter((e) => e.type === "power_tag" || e.type === "fellowship_tag")
		.map((e) => ({
			id: e.id,
			name: e.name,
			question: e.system?.question ?? null,
			isActive: !e.disabled,
			isScratched: e.system?.isScratched ?? false,
			type: e.type === "fellowship_tag" ? "fellowshipTag" : "powerTag",
		}));
}

get weaknessTags() {
	return this.parent.effects
		.filter((e) => e.type === "weakness_tag")
		.map((e) => ({
			id: e.id,
			name: e.name,
			question: e.system?.question ?? null,
			isActive: !e.disabled,
			isScratched: false,
			type: "weaknessTag",
		}));
}
```

Also update `themeTag` getter to remove the `TagData.fromSource` call:
```js
get themeTag() {
	return {
		id: this.parent._id,
		name: titleCase(this.parent.name),
		isActive: true,
		isScratched: this.isScratched ?? false,
		type: "themeTag",
	};
}
```

Remove the `effectToTag` import from the file. Keep `levelIcon`, `localize as t`, `titleCase`.

- [ ] **Step 3: Update `StoryThemeData`**

Apply the same pattern as ThemeData — update any `"theme_tag"` references to `"power_tag"` / `"weakness_tag"`. Check `scripts/item/story-theme/story-theme-data.js` and update accordingly.

- [ ] **Step 4: Update `BackpackData`**

In `scripts/item/backpack/backpack-data.js`, update any `effectToTag` usage to inline mapping (same pattern as ThemeData). The `story_tag` type name stays the same.

- [ ] **Step 5: Commit**

```bash
git add scripts/actor/effect-tags-mixin.js scripts/item/theme/theme-data.js scripts/item/story-theme/story-theme-data.js scripts/item/backpack/backpack-data.js
git commit -m "refactor: update mixin and item data models for new AE types"
```

---

## Task 7: Update HeroData — The Big One

**Files:**
- Modify: `scripts/actor/hero/hero-data.js`

- [ ] **Step 1: Update `effectTags` getter**

```js
get effectTags() {
	if (this.#cachedEffectTags) return this.#cachedEffectTags;
	const effects = [];
	for (const effect of this.parent.allApplicableEffects()) {
		if (effect.system?.isStatus || effect.type === "story_tag" || effect.type === "relationship_tag") {
			effects.push(effect);
		}
	}
	this.#cachedEffectTags = effects;
	return effects;
}
```

- [ ] **Step 2: Update `statuses` and `storyTags` getters**

```js
get statuses() {
	return this.effectTags
		.filter((effect) => effect.system?.isStatus)
		.filter((effect) => game.user.isGM || !effect.system?.isHidden)
		.map((effect) => ({
			id: effect._id,
			name: effect.name,
			type: "status",
			value: effect.system.currentTier,
		}));
}

get storyTags() {
	return this.effectTags
		.filter((effect) => effect.type === "story_tag")
		.filter((effect) => game.user.isGM || !effect.system?.isHidden)
		.map((effect) => ({
			id: effect._id,
			name: effect.name,
			type: "tag",
			isSingleUse: effect.system?.isSingleUse ?? false,
			value: 1,
		}));
}
```

- [ ] **Step 3: Update `relationshipTags` to read from AEs**

Replace the getter that reads from `this.relationships` array with one that reads `relationship_tag` effects:

```js
get relationshipTags() {
	return [...this.parent.effects]
		.filter((e) => e.type === "relationship_tag" && !e.system.isScratched)
		.map((e) => {
			const targetActor = game.actors.get(e.system.targetId);
			if (!targetActor) return null;
			return {
				id: e.id,
				name: `${targetActor.name} - ${e.name}`,
				displayName: e.name,
				themeId: `__relationship_${e.system.targetId}`,
				themeName: targetActor.name,
				actorImg: targetActor.img,
				type: "relationshipTag",
				isSingleUse: true,
				isScratched: e.system.isScratched,
				state: "",
				states: e.system.allowedStates,
			};
		})
		.filter(Boolean);
}
```

- [ ] **Step 4: Update `rollableTags` to use `allowedStates` from data models**

Key changes in `rollableTags`:
- Replace `states: ",positive,scratched"` with `states: tag.allowedStates ?? ",positive,scratched"` (where `tag` is the AE's system data)
- For theme power tags: iterate `item.effects` directly for `power_tag`/`fellowship_tag` effects instead of going through `item.system.powerTags`
- For weakness tags: iterate `item.effects` for `weakness_tag` effects
- For backpack: already reads `backpack.effects` — just update the `states` to use `e.system.allowedStates`

The shape of each tag entry stays the same (the roll dialog consumes this), but `states` now comes from the data model.

- [ ] **Step 5: Replace `toggleScratchTag` with delegation to `effect.system.toggleScratch()`**

```js
async toggleScratchTag(tag) {
	if (Hooks.call("litm.preTagScratched", this.parent, tag) === false) return;

	// For themeTag (the item-level theme identity tag), toggle on the item document
	if (tag.type === "themeTag") {
		const fellowshipActor = this.fellowshipActor;
		const theme = this.parent.items.get(tag.id) ?? fellowshipActor?.items.get(tag.id);
		if (!theme) return;
		await theme.parent.updateEmbeddedDocuments("Item", [
			{ _id: theme.id, "system.isScratched": !theme.system.isScratched },
		]);
		Hooks.callAll("litm.tagScratched", this.parent, tag);
		return;
	}

	// For all AE-backed tags, find the effect and delegate to toggleScratch
	const effect = this.#findEffect(tag.id);
	if (!effect) return;

	await effect.system.toggleScratch();
	Hooks.callAll("litm.tagScratched", this.parent, tag);
}

/**
 * Find an effect by ID across the hero, their items, and fellowship.
 * @param {string} effectId
 * @returns {ActiveEffect|null}
 */
#findEffect(effectId) {
	// Check actor effects and all applicable (transferred) effects
	for (const effect of this.parent.allApplicableEffects()) {
		if (effect.id === effectId) return effect;
	}
	// Check fellowship actor
	const fellowship = this.fellowshipActor;
	if (fellowship) {
		for (const item of fellowship.items) {
			const effect = item.effects.get(effectId);
			if (effect) return effect;
		}
	}
	return null;
}
```

- [ ] **Step 6: Update `scratchedTags` for new type names**

```js
get scratchedTags() {
	const tags = [];
	const tagTypes = new Set(["power_tag", "weakness_tag", "fellowship_tag", "story_tag"]);

	for (const item of this.parent.items) {
		for (const effect of item.effects) {
			if (!effect.system?.isScratched) continue;
			if (tagTypes.has(effect.type)) {
				tags.push({ id: effect.id, name: effect.name, source: "effect", itemId: item.id });
			}
		}
	}

	for (const effect of this.parent.effects) {
		if (tagTypes.has(effect.type) && effect.system?.isScratched) {
			tags.push({ id: effect.id, name: effect.name, source: "effect" });
		}
	}

	return tags;
}
```

- [ ] **Step 7: Commit**

```bash
git add scripts/actor/hero/hero-data.js
git commit -m "refactor: update HeroData for 6-type AE system with delegated toggleScratch"
```

---

## Task 8: Update FellowshipData

**Files:**
- Modify: `scripts/actor/fellowship/fellowship-data.js`

- [ ] **Step 1: Replace `scratchTag` with AE-based approach**

The old `scratchTag` method navigates legacy array paths. Replace with:

```js
async scratchTag(tagType, tagId) {
	if (tagType === "themeTag") {
		const theme = this.parent.items.get(tagId);
		if (!theme) return;
		await theme.update({ "system.isScratched": !theme.system.isScratched });
		return;
	}

	// Find the effect across all fellowship items
	for (const item of this.parent.items) {
		const effect = item.effects.get(tagId);
		if (effect) {
			await effect.system.toggleScratch();
			return;
		}
	}
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/actor/fellowship/fellowship-data.js
git commit -m "refactor: update FellowshipData.scratchTag for AE-based approach"
```

---

## Task 9: Update Sheet Files — Creators and Consumers

**Files:**
- Modify: `scripts/item/theme/theme-sheet.js`
- Modify: `scripts/item/story-theme/story-theme-sheet.js`
- Modify: `scripts/item/backpack/backpack-sheet.js`
- Modify: `scripts/sheets/base-actor-sheet.js`
- Modify: `scripts/apps/theme-advancement.js`

- [ ] **Step 1: Update ThemeSheet**

Replace `themeTagEffect` imports/calls with `powerTagEffect`/`weaknessTagEffect`/`fellowshipTagEffect`. In `#onAddTag`, determine the correct factory based on the tag type being added and whether the theme is a fellowship theme (`this.document.system.isFellowship`).

- [ ] **Step 2: Update StoryThemeSheet**

Same pattern — replace `themeTagEffect` with `powerTagEffect`/`weaknessTagEffect`.

- [ ] **Step 3: Update BackpackSheet**

Import `storyTagEffect` from utils (no name change needed, but verify the import path if `effectToTag` was also imported before and remove that import).

- [ ] **Step 4: Update base-actor-sheet.js**

- Replace `"status_card"` → `"status_tag"` in type checks
- Replace `"theme_tag"` → check for `power_tag`/`weakness_tag`/`fellowship_tag`
- Replace `statusCardEffect` → `statusTagEffect` import
- Replace `storyTagEffect` import if needed
- Update `_prepareStoryTags` to use `e.system?.isStatus` instead of `e.type === "status_card"`
- Update `_updateEmbeddedFromForm` type lookups

- [ ] **Step 5: Update ThemeAdvancementApp**

Replace `themeTagEffect` with `powerTagEffect`/`fellowshipTagEffect`. The advancement app creates power tags — determine if the parent theme is fellowship to choose the right factory.

- [ ] **Step 6: Commit**

```bash
git add scripts/item/theme/theme-sheet.js scripts/item/story-theme/story-theme-sheet.js scripts/item/backpack/backpack-sheet.js scripts/sheets/base-actor-sheet.js scripts/apps/theme-advancement.js
git commit -m "refactor: update sheet creators for new AE factory functions"
```

---

## Task 10: Update Roll System

**Files:**
- Modify: `scripts/apps/roll-dialog.js`
- Modify: `scripts/apps/roll.js`

- [ ] **Step 1: Update `LitmRoll.filterTags` to use `isStatus`**

Replace `type === "status"` checks with checking `tag.isStatus` (which would have been set from the data model's `isStatus` getter during tag preparation). Or if tags carry a `type` field, the existing pattern works — but update the value from `"status"` to match whatever `_prepareStoryTags` now emits.

- [ ] **Step 2: Update `calculatePower` to use `BURN_POWER`**

```js
import { LitmConfig } from "../system/config.js";

// In calculatePower:
const burnPower = scratchedTags.length * LitmConfig.BURN_POWER;
```

- [ ] **Step 3: Update roll-dialog tag/status getters**

- In the `tags` getter: remove `"burned"` → `"scratched"` normalization
- In the `statuses` getter: `"status_card"` → `"status_tag"` if filtering by type string
- In `decorateTag`: replace hardcoded `states` strings with `tag.states` from the data model (already set in `rollableTags`)
- In `gmTags` getter: remove `"burned"` normalization

- [ ] **Step 4: Commit**

```bash
git add scripts/apps/roll-dialog.js scripts/apps/roll.js
git commit -m "refactor: update roll system for new AE types and BURN_POWER constant"
```

---

## Task 11: Update Remaining Consumer Files

**Files:**
- Modify: `scripts/apps/story-tag-sidebar.js`
- Modify: `scripts/apps/spend-power.js`
- Modify: `scripts/sheets/tag-string-sync-mixin.js`
- Modify: `scripts/system/hooks/item-hooks.js`
- Modify: `scripts/system/hooks/chat-hooks.js`
- Modify: `scripts/system/sample-hero.js`
- Modify: `scripts/system/build-packs.js`
- Modify: `scripts/apps/welcome-overlay.js`
- Modify: `scripts/item/vignette/vignette-sheet.js`
- Modify: `scripts/item/litm-item.js`
- Modify: `scripts/actor/hero/hero-sheet.js`
- Modify: `scripts/actor/fellowship/fellowship-sheet.js`
- Modify: `scripts/actor/challenge/challenge-sheet.js`

- [ ] **Step 1: Global find-and-replace type strings**

Across all files listed above, apply these replacements:
- `"status_card"` → `"status_tag"`
- `"theme_tag"` → context-dependent: in validation/filter contexts, replace with checks for `"power_tag"`, `"weakness_tag"`, `"fellowship_tag"` as appropriate
- `statusCardEffect` → `statusTagEffect` (import name)
- `themeTagEffect` → `powerTagEffect` / `weaknessTagEffect` / `fellowshipTagEffect` (import name, context-dependent)
- `StatusCardData` → `StatusTagData` (import name and class references)
- `effectToTag` → remove import, inline the mapping or use direct AE access

- [ ] **Step 2: Update StoryTagSidebar `actors` getter**

In the `actors` getter (line 138), update the effect type filter:
```js
.filter((e) => e.type === "story_tag" || e.system?.isStatus)
```

And in the mapping (line 141):
```js
const isStatus = e.system?.isStatus ?? false;
```

- [ ] **Step 3: Update `tag-string-sync-mixin.js`**

Replace `"status_card"` → `"status_tag"` and `"story_tag"` stays the same. The tag string regex and parsing logic should continue to work — status tags are identified by the `-N` tier suffix in the string format.

- [ ] **Step 4: Update `item-hooks.js` addon sync**

Replace `statusCardEffect` → `statusTagEffect` import and calls.

- [ ] **Step 5: Update hero-sheet.js**

Remove duplicated scratch dispatch in `#onScratchTag` — delegate to `this.actor.system.toggleScratchTag(tag)` instead of reimplementing the type switch.

- [ ] **Step 6: Commit**

```bash
git add scripts/apps/ scripts/sheets/ scripts/system/ scripts/item/ scripts/actor/
git commit -m "refactor: update all consumer files for new AE type names"
```

---

## Task 12: Update Compendium Pack Sources

**Files:**
- Modify: `packs/status-effects/_source/*.json` (if any reference old type names)
- Run: `node scripts/system/build-packs.js`

- [ ] **Step 1: Check pack source files for old type references**

```bash
grep -r "status_card\|theme_tag" packs/
```

If any source files reference old types, update them.

- [ ] **Step 2: Rebuild packs if needed**

```bash
node scripts/system/build-packs.js
fvtt package pack status-effects
```

- [ ] **Step 3: Commit**

```bash
git add packs/
git commit -m "chore: rebuild compendium packs with new AE type names"
```

---

## Task 13: E2E Smoke Test

**Files:**
- Run: `tests/e2e/`

- [ ] **Step 1: Run existing E2E tests**

```bash
cd tests/e2e && npx playwright test
```

Verify that existing tests still pass. Fix any failures caused by type name changes in selectors or assertions.

- [ ] **Step 2: Manual smoke test checklist**

In a Foundry test world:
1. Create a new hero — verify themes with power/weakness tags render correctly
2. Open roll dialog — verify tags appear with correct states (positive/scratched for power, negative/positive for weakness)
3. Burn a tag — verify it scratches post-roll
4. Add a story tag to backpack — verify it appears on the hero
5. Add a status to a hero — verify tier boxes work, stacking works
6. Create a challenge — verify tag string sync works in edit/play modes
7. Check fellowship tags — verify single-use behavior, shared access
8. Check relationship tags — verify they appear in roll dialog

- [ ] **Step 3: Commit any test fixes**

```bash
git add tests/
git commit -m "test: fix E2E tests for new AE type names"
```

---

## Task 14: Clean Up HeroData Schema (Relationship Migration Cleanup)

**Files:**
- Modify: `scripts/actor/hero/hero-data.js`

- [ ] **Step 1: Remove `relationships` from `defineSchema`**

After the migration has run and relationship tags are AEs, the `relationships` array field in `HeroData.defineSchema()` is no longer needed for new data. However, keep it temporarily with a `migrateData` that strips it, so existing worlds don't error:

```js
static migrateData(source) {
	// Legacy relationship data is now stored as relationship_tag AEs
	delete source.relationships;
	return super.migrateData(source);
}
```

Update `relationshipEntries` to build from `relationship_tag` effects instead of the array.

- [ ] **Step 2: Update `relationshipEntries` getter**

```js
get relationshipEntries() {
	const heroActors = (game.actors ?? []).filter(
		(actor) => actor.type === "hero" && actor.id !== this.parent.id,
	);
	const existing = [...this.parent.effects]
		.filter((e) => e.type === "relationship_tag");

	return heroActors
		.map((actor) => {
			const effect = existing.find((e) => e.system.targetId === actor.id);
			return {
				actorId: actor.id,
				name: actor.name,
				img: actor.img,
				tag: effect?.name ?? "",
				isScratched: effect?.system?.isScratched ?? false,
				effectId: effect?.id ?? null,
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}
```

- [ ] **Step 3: Commit**

```bash
git add scripts/actor/hero/hero-data.js
git commit -m "refactor: migrate HeroData relationships to AE-based approach, strip legacy schema"
```

---

## Follow-Up (Not In This Plan)

**Ephemeral AE pattern for scene/story tags:** The StoryTagSidebar's world-level story tags (stored in `LitmSettings.storytags`) and scene tags (stored as canvas scene flags) should be wrapped in ephemeral `ActiveEffect` instances at read time to get the full data model surface. This is specified in SYSTEM.md under "Scene tags and world story tags — ephemeral AE pattern" but is a separate follow-up after the type system is stable. The sidebar currently works with plain objects — making it work with ephemeral AEs is additive and doesn't block the type refactor.
