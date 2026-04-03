# Data API Layer Design

## Goal

Replace the ad-hoc plain-object mapping and regrouping across the system with a clean data API where ActiveEffect documents flow directly from data models to consumers. Every getter returns `ActiveEffect[]` or structured groups of AEs. No intermediate object shapes.

## Core Principle

Each layer adds what it knows, nothing more:

- **AE data model** — everything about the tag in isolation (scratched, states, polarity, canBurn)
- **Item data model** — the tag's context within the item (which theme, theme name/image)
- **Actor data model** — structured groups that map to UI sections
- **Consumer (dialog/sheet/sidebar)** — transient UI state (selection, visibility filtering)

Consumers access AE properties via `effect.system.*` and item context via `effect.parent.*`. No plain object mapping anywhere in the data layer.

## AE Data Model Layer

The 6 AE data models (`PowerTagData`, `WeaknessTagData`, `FellowshipTagData`, `RelationshipTagData`, `StoryTagData`, `StatusTagData`) provide:

- `canBurn` — whether this tag can be burned for +3 Power
- `allowedStates` — valid SuperCheckbox cycle string
- `defaultPolarity` — `1`, `-1`, or `null`
- `isSuppressed` — returns `isScratched` (feeds Foundry's `effect.active` getter)
- `toggleScratch()` — updates `isScratched` on the parent document

### Removed

- `isStatus` — removed from all 6 types. Consumers use `effect.type === "status_tag"` directly.

### Foundry Integration

`effect.active` (a Foundry core getter) returns `!disabled && !isSuppressed`. Since `isSuppressed` returns `isScratched`, `effect.active` is the canonical check for "this tag is usable" — combines both disabled and scratched state. All consumers should use `effect.active` instead of manual `!disabled && !isScratched` checks.

## Item Data Model Layer

All tag getters return `ActiveEffect[]` directly. No plain object mapping.

### ThemeData

- `powerTags` → `ActiveEffect[]` — effects where `type === "power_tag"` or `type === "fellowship_tag"`
- `weaknessTags` → `ActiveEffect[]` — effects where `type === "weakness_tag"`
- `allTags` → `ActiveEffect[]` — all tag AEs on this theme (power + weakness + title tag)
- `activatedPowerTags` → `ActiveEffect[]` — power tags where `effect.active`
- `availablePowerTags` → `ActiveEffect[]` — same as `activatedPowerTags` (active = non-disabled and non-scratched)

The theme's title tag becomes a real `power_tag` AE (or `fellowship_tag` on fellowship themes) created on the item alongside other tags. This eliminates the synthetic `themeTag` getter that returned a plain object.

`theme.system.isScratched` stays on the item — it means "the entire theme is scratched" (all tags become unavailable), a separate concept from individual tag scratching.

### StoryThemeData

Same getters as ThemeData. Story themes have no Improve track, so weakness tags on them don't mark Improve.

### BackpackData

- `tags` → `ActiveEffect[]` — effects where `type === "story_tag"`
- `activeTags` → `ActiveEffect[]` — tags where `effect.active`

## Actor Data Model Layer

### Universal Mixin

A slim mixin applied to all actor data models provides:

- `tags` → `ActiveEffect[]` — effects where `type === "story_tag"`
- `statuses` → `ActiveEffect[]` — effects where `type === "status_tag"`

No filtering for hidden/active — that's a consumer concern. Just the raw AEs by type.

### HeroData

Structured getters that map directly to UI sections:

- `themes` → `[{ theme: Item, tags: ActiveEffect[] }]` — own non-fellowship themes, each with all their tag AEs
- `backpack` → `ActiveEffect[]` — story_tag AEs from the hero's backpack item
- `fellowship` → `{ themes: [{ theme: Item, tags: ActiveEffect[] }], tags: ActiveEffect[] }` — fellowship theme groups plus fellowship-level story tags and statuses
- `relationships` → `ActiveEffect[]` — relationship_tag AEs on the hero
- `statuses` → `ActiveEffect[]` — status_tag AEs on the hero (overrides mixin to be hero-specific, not including fellowship)
- `scratchedTags` → `ActiveEffect[]` — all scratched AEs across hero + fellowship items

No filtering for active/hidden — consumers decide based on context (edit mode shows all, play mode shows active, roll dialog shows active only).

### FellowshipData

Extends the universal mixin. Adds:

- `theme` → `Item` — the fellowship theme item
- `storyThemes` → `Item[]` — story_theme items
- `allTags` → `ActiveEffect[]` — all tag AEs across all fellowship themes

### ChallengeData / JourneyData

Use the universal mixin (`tags`, `statuses`) plus their existing `TagStringSyncMixin` for the string↔AE bridge.

## Roll Dialog

### Data Sources

All 6 data sources provide AEs through the same interface:

1. `actor.system.themes` — hero's own theme groups
2. `actor.system.backpack` — hero's backpack story tags
3. `actor.system.fellowship` — fellowship themes + tags
4. `actor.system.relationships` — relationship tag AEs
5. `actor.system.statuses` — hero's status AEs
6. Sidebar — ephemeral `ActiveEffect` instances from scene flags/settings

### Transient Selection State

The dialog maintains a `Map<string, {state, contributorId, sourceUuid}>` keyed by effect ID:

- `state` — `"positive"`, `"negative"`, `"scratched"`, or `""`
- `contributorId` — the user ID who selected this tag
- `sourceUuid` — UUID of the actor owning this AE (`null` = rolling actor). Uses UUID so unlinked tokens, compendium actors, etc. can all be resolved via `fromUuid()`.

### Multiplayer Contributions

When another player contributes a tag from their hero:
- Their selection is broadcast via socket as `{effectId, state, contributorId, sourceUuid}`
- The receiving dialog merges it into its Map

Post-roll scratch resolution:
- If `sourceUuid` is the rolling actor → call `effect.system.toggleScratch()` directly
- If `sourceUuid` is another actor → dispatch via socket to the owner of that actor

### `_prepareContext` Simplification

The owner path reads the structured getters directly and merges transient state from the Map. No regrouping logic — the data model already provides the right structure.

The template renders sections in order: themes → backpack → fellowship → relationships → statuses → scene tags. Each section reads AE properties directly.

### GM Viewer

Tabbed view per sidebar actor. Each tab reads that actor's structured getters (heroes) or the mixin's `tags`/`statuses` (challenges/journeys).

## Story Tag Sidebar

### Actor Tags

Reads from actor data model getters:
- `actor.system.tags` — story_tag AEs (from universal mixin)
- `actor.system.statuses` — status_tag AEs (from universal mixin)

No `allApplicableEffects()` bypass — uses the API.

### World-Level Story Tags

Stored as plain data in `LitmSettings.storytags`. At read time, the sidebar constructs ephemeral `ActiveEffect` instances:

```js
new ActiveEffect.implementation({
    name: "tag name",
    type: "story_tag",
    system: { ... }
});
```

These provide the same interface as actor-backed AEs. Mutations write back to settings storage.

### Scene Tags

Stored as canvas scene flags. The Scene Tag Dialog is the sole writer. When imported to the sidebar, they become sidebar-managed (settings-stored) and get the ephemeral AE treatment.

## Actor Sheets

### Hero Sheet

- **Play mode:** reads structured getters, templates filter for `effect.active`
- **Edit mode:** reads same getters, templates show all tags (including disabled/scratched)
- `_buildAllRollTags()` flattens structured getters into a single array for initializing the roll dialog

### Fellowship Sheet

Reads `actor.system.theme`, `actor.system.storyThemes`, `actor.system.tags`, `actor.system.statuses`.

### Challenge/Journey Sheets

Read `actor.system.tags`, `actor.system.statuses` from the mixin. `TagStringSyncMixin` continues to bridge edit/play mode.

### Template Changes

Templates access AE properties directly:
- `effect.name`, `effect.system.isScratched`, `effect.system.allowedStates`, `effect.active`, `effect.type`
- For theme context: `effect.parent.name`, `effect.parent.img`
- `play-tag.html` and `play-theme-tags.html` update to expect AE documents

`_prepareStoryTags()` in `base-actor-sheet.js` is removed.

## What Gets Removed

### Removed Getters

- `HeroData.effectTags` — replaced by specific getters
- `HeroData.rollableTags` — replaced by structured getters
- `HeroData.allTags`, `powerTags`, `weaknessTags`, `availablePowerTags` — consumers read from `themes`
- `HeroData.storyTags` — replaced by `backpack` + mixin `tags`
- `EffectTagsMixin.effectTags` — mixin provides only `tags` and `statuses`
- `base-actor-sheet._prepareStoryTags()` — sheets read getters directly
- `ThemeData.themeTag` — title tag becomes a real AE

### Removed from AE Data Models

- `isStatus` getter from all 6 types

### Removed Utilities

- `effectToTag()` — already removed
- `sortByTypeThenName` and 300+ lines of regrouping in `roll-dialog.js`

### Removed Concepts

- Plain tag objects as intermediate shape
- `fromFellowship` flag
- `"burned"` state normalization
