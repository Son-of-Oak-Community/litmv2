# Backpack Effect Sync Design

Unify backpack tags and story tags on hero actors by syncing backpack contents to transferred ActiveEffects, following the established `TagStringSyncMixin` pattern.

## Motivation

RAW, all personal story tags belong in the backpack. The current system stores backpack tags as `TagData` entries in `BackpackData.contents` and story tags as `story_tag` ActiveEffects directly on the actor — forcing users to understand an artificial distinction. Merging these into a single "Backpack" concept on the hero sheet brings the digital representation closer to the rules while simplifying the UI.

## Data Model

### No schema changes to BackpackData

The `contents` ArrayField remains the source of truth for tag data. `TagData` (with `id`, `name`, `isActive`, `isScratched`, `isSingleUse`, `type`) continues to define the shape.

### ActiveEffects as the derived play representation

Each `contents` entry syncs to a `story_tag`-typed ActiveEffect on the backpack item:

| Effect field | Source |
|---|---|
| `name` | `tag.name` |
| `transfer` | `true` (always — propagates to parent actor) |
| `disabled` | `!tag.isActive` |
| `system.isScratched` | `tag.isScratched` |
| `system.isSingleUse` | `tag.isSingleUse` |
| `system.isHidden` | Set based on context (GM-placed tags) |
| `flags.litmv2.contentsId` | `tag.id` (links effect back to contents entry) |

### isSuppressed on StoryTagData

Add a `get isSuppressed()` getter to `StoryTagData` that returns `this.isScratched`. This makes `effect.active` (which is `!disabled && !isSuppressed`) mean "unscratched and enabled" — so `actor.appliedEffects` returns only usable tags.

### Statuses unchanged

`StatusCardData` and status handling remain as direct effects on the actor. No changes.

## Sync Mechanism: BackpackSyncMixin

A new mixin applied to the hero sheet, modeled on `TagStringSyncMixin`.

### Contents → Effects

Triggers:
- Hero sheet first render (initial sync)
- Hero sheet switches from edit to play mode
- Backpack item contents are modified

Logic:
1. Get backpack item's `contents` and `effects`
2. Match by `flags.litmv2.contentsId`
3. **Create** effects for contents entries without a matching effect
4. **Update** effects where the matched content has changed (name, isActive→disabled, isScratched, isSingleUse)
5. **Delete** effects whose `contentsId` no longer exists in contents

### Effects → Contents

Hook-driven. When an effect with a `contentsId` flag is updated (e.g., scratched during a roll, renamed from the sidebar), find the matching contents entry and update it on the backpack item.

Registered hooks (on the hero sheet, same lifecycle as `TagStringSyncMixin`):
- `updateActiveEffect` — sync changes back to contents
- `deleteActiveEffect` — remove from contents

### Feedback loop prevention

A `_syncing` flag on the mixin prevents recursive updates, same pattern as `TagStringSyncMixin`.

### Revertability

The `contents` array is never removed. If the effect sync causes issues, disabling the mixin falls back to contents-based rendering. Effects can be wiped and re-synced from contents at any time.

## Hero Actor Helper Methods

Methods on the hero actor (or its sheet) that abstract tag routing:

### `addTag(tagData)`

Finds the backpack item, appends a `TagData` entry to its `contents` array. The sync creates the transferred effect.

### `removeTag(tagId)`

Removes the matching entry from backpack `contents` by id. The sync deletes the effect.

### `updateTag(tagId, updateData)`

Finds the contents entry, merges the update data. The sync propagates changes to the effect.

### `toggleTagActive(tagId)`

Convenience method. Calls `updateTag(tagId, { isActive: !current })`.

### `toggleTagScratched(tagId)`

Convenience method. Calls `updateTag(tagId, { isScratched: !current })`. Replaces the `"backpack"` case in the existing `toggleScratchTag` method.

### Routing

These helpers only apply to hero actors for backpack-routed tags. For statuses (direct actor effects) and non-hero actors, existing patterns remain unchanged.

Consumers identify backpack-synced effects by checking `effect.flags?.litmv2?.contentsId`.

## Query Surface Changes

### Key change

Code querying hero tags must use `actor.allApplicableEffects()` instead of `actor.effects` to pick up transferred effects from the backpack item.

### Affected consumers

**HeroData.storyTags getter** — Currently filters `actor.effects`. Must use `allApplicableEffects()`. The existing `instanceof StoryTagData` check still works.

**Roll dialog `_buildBackpackRollTags()`** — Currently reads from `backpackItem.system.contents`. Changes to read from transferred effects. This method merges with the story tag collection path since they are now the same source.

**Story tag sidebar** — Already works with ActiveEffects. Uses hero helper methods for updates on hero actors. For challenges/journeys, continues to work with effects directly.

**`_onDropTagOrStatus` in base-actor-sheet** — For heroes, routes tags to backpack contents via `addTag()`. For non-heroes, creates direct effects as today.

### Unaffected consumers

- Challenge/journey sheets (own tag string sync pattern)
- Fellowship sheet (queries effects directly)
- StatusCardData handling (untouched)

## Hero Sheet UI Changes

### Edit mode

- Merge the current separate "Backpack" and "Story Tags & Statuses" fieldsets into a single **"Backpack"** fieldset
- Story themes still render in this section but remain separate items
- Tags show: name input, active/inactive checkbox, single-use toggle, scratched indicator, delete button
- Statuses remain in their own section (direct actor effects)
- The "edit backpack item" button stays for bulk management (name, image)

### Play mode

- One unified tag list from `allApplicableEffects()` filtered to `story_tag` type
- Same visual language as today (golden tags, scratched state, single-use hourglass)
- Active/inactive state via dimmed visual treatment or existing toggle pattern
- Statuses render separately as today

## Scope

### In scope

- `BackpackSyncMixin` on the hero sheet
- Contents → effect bidirectional sync with `transfer: true`
- `isSuppressed` getter on `StoryTagData`
- Helper methods on hero actor (`addTag`, `removeTag`, `updateTag`, `toggleTagActive`, `toggleTagScratched`)
- Drop handler routing: tags → backpack contents for heroes, direct effects for others
- Hero sheet UI merge (backpack + story tags → single "Backpack" section, statuses stay separate)
- Sidebar updates to use hero helpers for hero actors
- Roll dialog consolidation (one tag source instead of two)

### Out of scope

- Theme power/weakness tags as ActiveEffects (future work)
- Unified tag API across all actor types (revisit after themes are covered)
- Custom `ActiveEffectConfig` subclass for story tags
- Changes to challenge/journey tag handling
- Changes to fellowship tag handling
- Changes to status card handling

### Future consideration

Once themes also use transferred ActiveEffects, revisit and refine the tag helper API to be consistent across all actor types. The current helpers are hero-specific and backpack-scoped by design — they will likely generalize once the pattern proves out.
