# Game System Overview

This document provides an overview of the game system, including its architecture, components, and interactions. It serves as a guide for AI agents to understand how the game operates and how different parts of the system work together.

## Game Concepts

Legend in the Mist is a tag-based RPG. Instead of numeric stats, characters are defined entirely by short descriptors called **tags**. Tags have a dual role: they define what's true in the story, and they add or reduce the **Power** of a Hero's actions.

### Tag Taxonomy (from the Core Rules)

**Power Tags** — Permanent positive tags on a Hero's themes. Each gives +1 Power when invoked in an action. Can be **scratched** (temporarily unavailable) or **burned** (+3 Power instead of +1, then scratched). Cannot normally be used against the Hero, but the Narrator can invoke it against the Hero if they want.

> **Burn vs. Scratch**: "Burn" is a **roll-time action** — the player chooses to invoke a tag for +3 Power instead of +1, at the cost of scratching it. "Scratched" is the **resulting persistent state** — the tag is unavailable until recovered. There is no "burned" state on a tag. A tag is either scratched or it isn't.

**Weakness Tags** — Permanent negative tags on a Hero's themes. Each gives -1 Power when invoked. Invoking a weakness tag marks **Improve** on its theme (the primary advancement mechanic). Cannot normally be used in the Hero's favor, but the Narrator can invoke it as a positive without marking **Improve** if they deem it warranted. Cannot be scratched.

**Story Tags** — Temporary/impermanent tags gained during play. Can be helpful OR hindering depending on context (+1 or -1 Power). Can be burned for +3 Power. Created or scratched by spending 2 Power. Expire when no longer narratively true. Stored in the Hero's **backpack** or on tracking cards. Variants:

- **Single-use** — scratched after one invocation; created with last 1 Power. **Cannot be burned** (since burning a disposable tag would always dominate normal invocation)
- **Consumable** — burned when fully consumed for +3 (scratched when burned), or used normally for +1 (rationed)

**Statuses** — Special tags with a **tier** (1–6) measuring intensity. Only the highest positive and highest negative status count toward a roll. Stack when reapplied (mark new tier; if box occupied, shift right). Related to **Limits** — when a status reaches or exceeds a Limit, the target is overcome. Expire at Narrator discretion.

**Fellowship Power Tags** — Power tags on the shared Fellowship theme. **Single-use** (scratched when invoked). **Cannot be burned** for Power. Shared across all Heroes. Recoverable during camp/sojourn or with certain Fellowship abilities.

**Relationship Tags** — Single-use story tags each Hero has for each other Hero in the Fellowship. **Single-use** (scratched when invoked). **Cannot be burned** for Power. Represent how your Hero feels about another Hero. **Renewed during camp/sojourn** (Fellowship Quality Time). Optionally treated as weakness tags of the Fellowship theme (marking Improve when invoked negatively).

**Story Theme Tags** — Story tags elevated into a mini-theme with additional tags (positive and negative). The negative tag is a `weakness_tag`, but story themes have no Improve track, so invoking it doesn't mark Improve. However, unlike regular story tags, **the Narrator can reintroduce a story theme's negative tag** as long as the theme remains — scratching it only removes it temporarily. The entire story theme is impermanent and can be removed.

### Statuses & Limits

Statuses track conditions on Heroes, Challenges, and environment:

- **Tier 1–4**: Temporary conditions of increasing severity
- **Tier 5** (default Hero Limit): Hero is **overcome** — cannot act, loses control of the scene
- **Tier 6**: Deadly or transformative — permanent change

**Stacking**: When the same/similar status is reapplied, mark the new tier box. If already marked, shift right to the next free box. Highest marked box = current tier.

**Limits on Challenges**: Each Challenge has named Limits (e.g., _harm-4_, _convince-3_). Reaching a Limit overcomes that aspect of the Challenge.

### Power Calculation

When rolling (Quick or Detailed outcome):

- +1 per helpful (positive) tag
- -1 per hindering (negative) tag
- +tier of highest helpful status
- -tier of highest hindering status
- +3 for one burned tag (max one per roll)
- ±3 or ±6 for Might difference
- Minimum 1 Power to spend on Success (Rule of Minimum One)

### Spending Power (Detailed Outcomes)

On success, spend Power on Effects:

- **Add/recover/scratch a tag**: 2 Power
- **Give/reduce a status**: 1 Power per tier
- **Discover a valuable detail**: 1 Power
- **Extra feat** (narrative bonus): 1 Power (only after main purpose spent)
- **Single-use tag** (with last 1 Power): 1 Power

## Architecture

The game consists of **item** and **actor** entities. Items are embedded onto actors to give them capabilities. Items carry Active Effects, which serve as the primary data containers for tags and statuses throughout the system.

### Document Hierarchy

```
Actor (hero, challenge, journey, fellowship)
  ├── Embedded Items (theme, backpack, story_theme, addon, vignette, etc.)
  │     └── ActiveEffects (power_tag, weakness_tag on theme items; story_tag on backpack)
  └── Direct ActiveEffects (story_tag, status_tag, relationship_tag on actors)
```

## Active Effects

Active Effects are the **canonical data store** for all tags and statuses. Each effect has a `type` that maps to a `TypeDataModel` subclass defining its schema and mechanics.

### Effect Types

There are **6** distinct Active Effect types, each modeling a specific game concept with its own mechanical rules:

#### `power_tag`

**Lives on:** `theme`, `story_theme`, or fellowship `theme` items (never on actors directly)

Represents a permanent positive tag on a Hero's theme. Gives +1 Power when invoked. Can be scratched (temporarily unavailable) or burned (+3 Power, then scratched).

| Field         | Type                | Description                                                   |
| ------------- | ------------------- | ------------------------------------------------------------- |
| `question`    | `String` (nullable) | Index into the themebook's question array (e.g. `"A"`, `"B"`) |
| `isScratched` | `Boolean`           | Tag has been scratched (burned or as a Consequence)           |

- `disabled` (base AE field) encodes whether the tag is unlocked/active (`disabled: false` = active). Tags start disabled and are activated during character creation or theme advancement.
- `isSuppressed` getter returns `this.isScratched` — Foundry skips suppressed effects
- Does **not** transfer to the parent actor. Read directly from the item via `ThemeData.powerTags`.

Computed getters:
- `get isStatus()` → `false`
- `get canBurn()` → `!this.isScratched`
- `get allowedStates()` → `",positive,scratched"`
- `get defaultPolarity()` → `1` (always positive)

Methods:
- `async toggleScratch()` — updates `system.isScratched` on this effect's parent document

#### `weakness_tag`

**Lives on:** `theme`, `story_theme`, or fellowship `theme` items (never on actors directly)

Represents a permanent negative tag on a Hero's theme. Gives -1 Power when invoked. Invoking marks **Improve** on the theme. Cannot normally be scratched.

| Field      | Type                | Description                               |
| ---------- | ------------------- | ----------------------------------------- |
| `question` | `String` (nullable) | Index into the themebook's question array |

- `disabled` encodes unlocked/active state, same as `power_tag`
- Does **not** transfer to the parent actor. Read directly from the item via `ThemeData.weaknessTags`.
- Mechanically distinct from `power_tag`: cannot be burned, invocation triggers Improve tracking, polarity is always negative.

Computed getters:
- `get isStatus()` → `false`
- `get canBurn()` → `false`
- `get allowedStates()` → `",negative,positive"`
- `get defaultPolarity()` → `-1` (always negative)

#### `fellowship_tag`

**Lives on:** Fellowship `theme` item (never on actors directly)

Represents a shared single-use power tag on the Fellowship theme. Any Hero can invoke it. Scratched on invocation. **Cannot be burned** for Power. Recoverable during camp/sojourn.

| Field         | Type                | Description                                          |
| ------------- | ------------------- | ---------------------------------------------------- |
| `question`    | `String` (nullable) | Index into the Fellowship themebook's question array |
| `isScratched` | `Boolean`           | Scratched after invocation                           |

- `disabled` encodes unlocked/active state
- `isSuppressed` getter returns `this.isScratched`
- Mechanically distinct from `power_tag`: always single-use, cannot be burned, shared across all Heroes

Computed getters:
- `get isStatus()` → `false`
- `get canBurn()` → `false` (single-use tags cannot be burned)
- `get allowedStates()` → `",positive,negative"`
- `get defaultPolarity()` → `1` (always positive)

Methods:
- `async toggleScratch()` — updates `system.isScratched` on this effect's parent document

#### `relationship_tag`

**Lives on:** Hero actors directly

Represents a single-use story tag linking one Hero to another in the Fellowship. Renewed during camp/sojourn (Fellowship Quality Time).

| Field         | Type      | Description                 |
| ------------- | --------- | --------------------------- |
| `targetId`    | `String`  | ID of the target Hero actor |
| `isScratched` | `Boolean` | Scratched after invocation  |

- Always single-use (scratched on invocation)
- Optionally treated as a Fellowship weakness tag (marks Improve on the Fellowship theme when invoked negatively)
- Renewed/rephrased during camp scenes — the name changes to reflect evolving relationships

Computed getters:
- `get isStatus()` → `false`
- `get canBurn()` → `false` (single-use tags cannot be burned)
- `get allowedStates()` → `",positive"`
- `get defaultPolarity()` → `1` (positive by default)

Methods:
- `async toggleScratch()` — updates `system.isScratched` on this effect's parent document

#### `story_tag`

**Lives on:** `backpack` items (with `transfer: true`), directly on actors, or as scene-level tags

Represents a temporary tag gained during play. Can be helpful or hindering depending on context. Expires when no longer narratively true.

| Field         | Type                | Description                                |
| ------------- | ------------------- | ------------------------------------------ |
| `isScratched` | `Boolean`           | Tag has been scratched (burned or removed) |
| `isSingleUse` | `Boolean`           | Scratched after one invocation             |
| `isHidden`    | `Boolean`           | Hidden from non-GM players                 |
| `limitId`     | `String` (nullable) | Links to a challenge/journey for grouping  |

- When on a `backpack` item with `transfer: true`, Foundry surfaces the effect on the parent actor via `allApplicableEffects()`
- For Heroes, story tags route through the backpack item. For other actor types (challenge, journey, fellowship), they live directly on the actor.
- Challenge/journey/environment tags are `story_tag` effects on those actors — the **origin** (which actor owns the effect) distinguishes them from Hero story tags.

Computed getters:
- `get isStatus()` → `false`
- `get canBurn()` → `!this.isSingleUse && !this.isScratched`
- `get allowedStates()` → `this.isSingleUse ? ",positive,negative" : ",positive,negative,scratched"`
- `get defaultPolarity()` → `null` (context-dependent)

Methods:
- `async toggleScratch()` — updates `system.isScratched` on this effect's parent document

#### `status_tag`

**Lives on:** Actors directly (any actor type)

Represents a tiered status condition (1–6). Tracks intensity via marked tier boxes. Related to Limits for overcoming Challenges and Heroes.

| Field      | Type                | Description                               |
| ---------- | ------------------- | ----------------------------------------- |
| `tiers`    | `Boolean[6]`        | Six tier boxes, each `true` = filled      |
| `isHidden` | `Boolean`           | Hidden from non-GM players                |
| `limitId`  | `String` (nullable) | Links to a challenge/journey for grouping |

- `currentTier` getter: `lastIndexOf(true) + 1` (0–6)
- `markTier(tiers, tier)`: Static pure function — marks a box, stacking to the next free slot if occupied
- `stackTiers(tierArrays)`: Static — merges multiple status cards into combined tiers (used by StoryTagSidebar for limit totals)
- `calculateReduction(amount)`: Shifts marks left, dropping any below index 0
- Challenge/environment statuses are `status_tag` effects on those actors — the **origin** distinguishes them.

Computed getters:
- `get isStatus()` → `true`
- `get canBurn()` → `false`
- `get allowedStates()` → `",positive,negative"`
- `get defaultPolarity()` → `null` (context-dependent)

**Status subtypes** (Narrator-adjudicated, not separate AE types):
- **Compelling** — includes a directive (e.g. *charmed*, *enraged*, *convinced*). Hinders every action that goes against the directive. At Limit tier, the directive cannot be resisted. Beyond Limit, becomes permanent.
- **Polar** — opposing status pairs (e.g. *hot/cold*, *friendly/hostile*). Cannot coexist on the same target. Incoming polar status reduces the existing one; if greater, flips polarity with the remainder.
- **Defensive** — protects the target. Can be **standard** (affects Power of incoming attacks/reactions) or **ablative** (must be fully removed before the opposing status can be applied toward a Limit). Can be both.

### Shared Computed Interface

All six AE data models implement these computed getters and methods, eliminating ad-hoc state logic from the UI layer:

| Getter/Method | Purpose | Replaces |
| --- | --- | --- |
| `get isStatus()` | `true` for `status_tag`, `false` for all others | Ad-hoc `type === "status"` checks in EffectTagsMixin, roll dialog, sidebar, base sheet |
| `get canBurn()` | Whether this tag can be burned for +3 Power | Implicit presence/absence of `"scratched"` in the `states` string |
| `get allowedStates()` | Valid SuperCheckbox cycle for this tag | Hardcoded `states` strings in 5+ locations (rollableTags, decorateTag, tags/statuses/gmTags getters) |
| `get defaultPolarity()` | `1` (positive), `-1` (negative), or `null` (context-dependent) | Type-based branching in LitmRoll.filterTags and calculatePower |
| `async toggleScratch()` | Updates `isScratched` on the correct parent document | 5-branch type switch in HeroData.toggleScratchTag and duplicated logic in HeroSheet.#onScratchTag |

**`BURN_POWER` constant**: The value `3` (Power gained from burning a tag) is defined as a named constant on `LitmConfig` rather than hardcoded in `calculatePower`.

### Type Summary

| Type               | Lives On                | Transfers?     | Polarity             | Single-Use | Can Burn | Marks Improve |
| ------------------ | ----------------------- | -------------- | -------------------- | ---------- | -------- | ------------- |
| `power_tag`        | theme/story_theme items | No             | Always positive (+1) | No         | Yes (+3) | No            |
| `weakness_tag`     | theme/story_theme items | No             | Always negative (-1) | No         | No       | If parent has Improve track |
| `fellowship_tag`   | fellowship theme item   | No             | Always positive (+1) | Yes        | No       | No            |
| `relationship_tag` | hero actors             | N/A            | Context-dependent    | Yes        | No       | Optional      |
| `story_tag`        | backpack items / actors | Yes (backpack) | Context-dependent    | Optional   | Yes      | No            |
| `status_tag`      | actors                  | No             | Context-dependent    | N/A        | N/A      | No            |

### Factory Functions (`scripts/utils.js`)

These produce plain creation-data objects suitable for `createEmbeddedDocuments("ActiveEffect", [...])`:

- `powerTagEffect({ name, isActive, question, isScratched })` → `{ name, type: "power_tag", disabled: !isActive, system: {...} }`
- `weaknessTagEffect({ name, isActive, question })` → `{ name, type: "weakness_tag", disabled: !isActive, system: {...} }`
- `fellowshipTagEffect({ name, isActive, question, isScratched })` → `{ name, type: "fellowship_tag", disabled: !isActive, system: {...} }`
- `relationshipTagEffect({ name, targetId })` → `{ name, type: "relationship_tag", system: { targetId } }`
- `storyTagEffect({ name, isScratched, isSingleUse, isHidden, limitId })` → `{ name, type: "story_tag", system: {...} }` — callers add `transfer: true` at the call site when routing through a backpack
- `statusTagEffect({ name, tiers, isHidden, limitId })` → `{ name, type: "status_tag", system: {...} }`

### Transfer Behavior

The `transfer: true` flag on an ActiveEffect causes Foundry to surface it on the parent actor via `allApplicableEffects()`, even though the effect physically lives on an embedded item.

**What transfers:**

- `story_tag` effects on `backpack` items → appear on the hero actor

**What does NOT transfer:**

- `power_tag`, `weakness_tag`, `fellowship_tag` — read directly from theme items via data model getters
- `status_tag` — always created directly on actors
- `relationship_tag` — already lives on the actor

### Effect Routing

Because effects can live on actors or on embedded items, updates and deletes must be routed to the correct parent document.

**`updateEffectsByParent(actor, updates)`** resolves this:

1. Builds an `effectId → effect` map from `actor.allApplicableEffects()`
2. Groups each update by its effect's `.parent` (actor or embedded item)
3. Calls `parent.updateEmbeddedDocuments("ActiveEffect", [...])` per group

**`_updateEmbeddedFromForm(submitData)`** on actor sheets:

1. Parses `effects.<id>.<field>` keys from form data
2. Normalizes special cases (e.g. `system.tierValue` number → `system.tiers` boolean array)
3. Routes through `updateEffectsByParent`

### Validation Hooks

- `preCreateActiveEffect` → `_validateEffectType`: Blocks `power_tag`/`weakness_tag`/`fellowship_tag` creation on anything other than appropriate item types
- `preCreateActiveEffect` → `_setStatusTagIcon`: Sets icon and `showIcon: ALWAYS` on `status_tag` effects for token display

### Effect Lifecycle by Context

#### Theme Sheets (theme, story_theme)

- **Create:** `ThemeSheet.#onAddTag` → `item.createEmbeddedDocuments("ActiveEffect", [powerTagEffect(...)])` or `weaknessTagEffect(...)`
- **Delete:** `ThemeSheet.#onRemoveTag` → `item.deleteEmbeddedDocuments("ActiveEffect", [id])`
- **Update:** `LitmItemSheet._onSubmitFormWithEffects` → parses `effects.*` form keys, normalizes `isActive` → `disabled`

#### Backpack Sheet

- **Create:** `BackpackSheet.#onAddTag` → `item.createEmbeddedDocuments("ActiveEffect", [{ ...storyTagEffect(...), transfer: true }])`
- **Delete:** `BackpackSheet.#onRemoveTag` → `item.deleteEmbeddedDocuments("ActiveEffect", [id])`

#### Actor Sheets (base)

- **Add story tag:** `_onAddStoryTag` — for heroes, routes to backpack with `transfer: true`; for others, creates directly on actor
- **Drop tag/status:** `_onDropTagOrStatus` — handles drag-and-drop, stacks duplicate statuses via `calculateMark`
- **Remove:** `_onRemoveEffect` — looks up on actor then backpack, calls `effect.delete()`

#### Fellowship Theme

- Fellowship `power_tag` effects use `fellowship_tag` type instead
- Weakness tags on fellowship themes use standard `weakness_tag` type (invoking marks Improve on the Fellowship theme)
- Relationship tags are created/renewed on hero actors during camp scenes

#### Challenge/Journey (TagStringSyncMixin)

These actors have a dual representation: a `system.tags` string (canonical in edit mode) and ActiveEffects (canonical in play mode).

`TagStringSyncMixin` synchronizes between them:

- **Edit→Play transition:** `_syncEffectsFromString` deletes all non-addon story/status effects, recreates from parsed tag string
- **AE hooks (play mode):** `createActiveEffect`, `updateActiveEffect`, `deleteActiveEffect` hooks update the string to match

#### Addon Items

- `syncAddonEffects` (item-hooks.js): Parses addon's `system.tags` string, creates `story_tag`/`status_tag` effects on the parent actor, flagged with `flags.litmv2.addonId`
- `resyncAddonEffects`: On addon update, deletes all effects with matching `addonId` flag, then recreates

#### Theme Advancement

- Can create new tags (`powerTagEffect` with `isActive: true`) or activate existing ones (update `disabled: false`)

## Data Flow: Reading Tags

### Hero Actor

```
HeroData.allTags
  = backpack.tags (BackpackData reads item.effects for story_tag → effectToTag)
  + themeItems.flatMap(item.system.allTags) (ThemeData reads item.effects for power_tag/weakness_tag)

HeroData.effectTags
  = actor.allApplicableEffects() filtered for story_tag + status_tag + relationship_tag
  (includes transferred backpack effects)

HeroData.rollableTags
  = own themes' power_tag effects
  + fellowship themes' fellowship_tag effects
  + backpack story_tag effects
  + relationship_tag effects
  (filtered: active, non-scratched only)

HeroData.statuses  → effectTags filtered for status_tag → { id, name, value: currentTier }
HeroData.storyTags → effectTags filtered for story_tag → { id, name, isSingleUse, value: 1 }
```

### Other Actors (via EffectTagsMixin)

```
effectTags = actor.allApplicableEffects() filtered for story_tag + status_tag
statuses   = effectTags filtered for status_tag (hidden filtered for non-GMs)
storyTags  = effectTags filtered for story_tag (hidden filtered for non-GMs)
```

## Roll System Integration

1. `HeroSheet` builds `characterTags` from `HeroData.rollableTags` — each tag carries its `allowedStates` from the data model
2. `LitmRollDialog` merges character tags with scene-level story tags from `StoryTagSidebar`
3. User selects tags via `SuperCheckbox`, which cycles through `allowedStates` provided by the data model
4. `LitmRoll.filterTags` categorizes by `state` × `isStatus`: scratched tags, positive/negative tags, positive/negative statuses
5. `calculatePower()` computes: `scratchedTags * BURN_POWER + powerTags - weaknessTags + maxPositiveStatus - maxNegativeStatus + modifier + might + tradePower`
6. `LitmRoll` evaluates the formula
7. Post-roll: scratched tags and single-use tags are auto-scratched via `effect.system.toggleScratch()` on each effect's own data model

## StoryTagSidebar

Replaces Foundry's Combat Tracker (`CONFIG.ui.combat`). Manages scene-level tags and displays actor effects.

- Reads tags via `actor.allApplicableEffects()` for each scene actor
- Supports drag-and-drop of tags/statuses between actors and the sidebar
- Quick-add routes hero tags through backpack, others directly on actor
- Stacks duplicate statuses using `StatusTagData.stackTiers`

## Legacy Constructs to Migrate

The following existing constructs are superseded by the new AE type system and need migration:

### `TagData` (embedded data model)

`scripts/data/tag-data.js` — a `SchemaField`-based model currently embedded in Item data models (themes, backpacks). Has its own `type` field with values `"powerTag"`, `"weaknessTag"`, `"backpack"`, `"themeTag"`, `"relationshipTag"`. This is **superseded** by the typed AE data models. The `effectToTag()` bridge function maps AEs to `TagData`-compatible objects — once all consumers read directly from the AE data models and their computed getters, both `TagData` and `effectToTag()` can be removed.

### Relationship tags as plain data

Relationship tags are currently stored as a plain array on `HeroData.system.relationships`, not as ActiveEffects. The `toggleScratchTag` method has a dedicated branch for `"relationshipTag"` that updates this array. Under the new spec, relationship tags become `relationship_tag` AE effects on the hero actor, requiring a data migration.

### Scene tags and world story tags — ephemeral AE pattern

Scene-level tags are stored as canvas scene flags (`canvas.scene.getFlag("litmv2", "sceneTags")`), and world-level story tags are stored in `LitmSettings.storytags`. Neither storage backend supports embedded ActiveEffects natively.

**Solution: Ephemeral ActiveEffects.** At read time, construct unowned `ActiveEffect` instances from the stored plain data:

```js
const effect = new ActiveEffect.implementation({
  name: "wounded",
  type: "status_tag",
  system: { tiers: [true, true, false, false, false, false] }
});
// effect.system is a StatusTagData instance — full getter surface works
```

Foundry supports parentless AE construction (used internally by `fromStatusEffect`). The `type` field triggers `CONFIG.ActiveEffect.dataModels` resolution, so the `system` property is a real `TypeDataModel` instance with all computed getters (`allowedStates`, `canBurn`, `isStatus`, etc.).

**Write paths differ by context:**
- **Scene Tag Dialog** — writes directly to scene flags as plain data. Read-only from the sidebar's perspective; the dialog is the sole writer.
- **StoryTagSidebar** — when scene tags are imported into the sidebar, they become sidebar-managed. The sidebar handles bidirectional writes: it constructs ephemeral AEs for reading/display and writes mutations back to `LitmSettings.storytags`. `toggleScratch()` on unowned effects detects the ephemeral context and routes writes to the settings storage.
- **Actor tags** — remain real embedded AEs with standard `updateEmbeddedDocuments` writes. No change.

### `"burned"` state references

The roll dialog normalizes `"burned"` → `"scratched"` inline in the `tags` and `gmTags` getters. This is legacy from before the burn/scratch distinction was clarified. These normalizations can be removed — `"burned"` is not a valid tag state.
