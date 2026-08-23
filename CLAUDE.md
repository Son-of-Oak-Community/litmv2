# CLAUDE.md

Guidance for Claude Code when working on litmv2.

## About

Legend in the Mist is a Foundry VTT v14 system (id: `litmv2`) for a rustic fantasy RPG based on the Mist Engine. Pure ES modules — no build step.

Foundry source is symlinked at `./foundry/` (client code in `public/`, CSS at `public/css/foundry2.css`). API docs: <https://foundryvtt.com/api/v14/>. Prefer the `fvtt-v14-*` skills for Foundry patterns and `find-docs` for API lookup.

## Commands

- `npm test` — Vitest unit-test suite
- `npm run i18n:check` — find missing/superfluous localization keys
- `npm run i18n:diff` — translator diagnostic; diffs each non-English language against `lang/en.json`

Local runtime-verification steps (launching the test world, rules-as-written source path) live in the gitignored `CLAUDE.local.md` — machine-specific, so not checked in.

## Extensibility (don't break the public API surface)

litmv2 is meant to be extended by modules/macros, not forked. The three extension surfaces:

- **`game.litmv2`** (`litmv2.js`) — replaceable app/roll classes, `data.*` models, `methods.*`, `fellowship` singleton getter, `ContentSources`
- **`CONFIG.litmv2`** (`modules/system/config.js`) — `roll.{formula,resolver}`, `heroLimit`, theme tiers, asset paths, tag-type constants, tag-string regex
- **Custom hooks** `litm.*` — see "Custom System Hooks" below

Read those two files for the current surface rather than trusting a list here.

When refactoring, preserve these even when they look unused internally. New behaviours third parties might want to swap should be a class on `game.litmv2`, a slot on `CONFIG.litmv2`, or a `litm.*` hook — not a private helper.

## Game Concepts

litmv2 is a tag-based RPG. Characters are defined by short descriptors (tags) that add or reduce the **Power** of a Hero's actions.

### Tag Taxonomy

| Type | Lives On | Polarity | Single-Use | Can Burn |
|------|----------|----------|-----------|---------|
| `power_tag` | theme/story_theme items | +1 | No | Yes (+3) |
| `weakness_tag` | theme/story_theme items | -1 | No | No — invoking marks Improve |
| `fellowship_tag` | fellowship theme item | +1 | Yes | No |
| `relationship_tag` | hero actors | +1 default | Yes | No |
| `story_tag` | backpack items (transfer) / actors | Context | Optional | Yes (unless single-use) |
| `status_tag` | actors | Context (tier 1–6) | N/A | N/A |

- "Burn" is a roll-time action; "scratched" is the resulting persistent state. There is no "burned" state on a tag.
- Statuses stack when reapplied (mark new tier; shift right if occupied). Only the highest positive and highest negative status count toward a roll.
- Statuses can link to **Limits**: when value reaches the limit's effective max, the target is overcome.

### Enricher Tag Syntax (prose chips)

- `[name]` → story tag
- `[name!]` → single-use story tag
- `[name-N]` → status tier N (`[name-]` for tier-less)
- `[name:N]` → limit (max N), `[name:]` for unbounded
- `[-name]` → weakness chip (draggable to a theme/story_theme to create a real `weakness_tag` effect)

`[-name]` and `[name:N]` are enricher-only — they render styled chips but don't flow through the AE-creation parser in `modules/item/action/tag-string.js`.

### Power Calculation

`scratched*BURN_POWER + powerTags - weaknessTags + maxPositiveStatus - maxNegativeStatus + modifier + might + tradePower`

- +3 for one burned tag (max one per roll)
- ±3 or ±6 for Might difference

### Spending Power (post-roll)

- Add/recover/scratch a tag: **2**
- Give/reduce a status: **1 per tier**
- Discover a valuable detail: **1**
- Extra feat (after main purpose spent): **1**
- Single-use tag (with last 1 Power): **1**

## Architecture

### Document Types

| Document | Types |
|----------|-------|
| **Actor** | `hero`, `journey`, `challenge`, `fellowship`, `story_theme` |
| **Item** | `theme`, `themebook`, `trope`, `backpack`, `story_theme`, `vignette`, `addon` |
| **ActiveEffect** | `power_tag`, `weakness_tag`, `fellowship_tag`, `relationship_tag`, `story_tag`, `status_tag` |

Data models live at `modules/<actor|item|active-effects>/{type}/{type}-data.js`. Custom doc classes: `LitmItem` (legacy tag→effect migration) and `LitmActiveEffect`.

### Actor-Item Relationships

```
Hero ---+--- 4x theme  (power_tag/weakness_tag effects)
        +--- 1x backpack (story_tag effects, transfer: true)
        +--- fellowshipId ---> Fellowship (singleton)
                                  +--- 1x theme (isFellowship=true)
                                  +--- Nx story_theme

Challenge ---+--- Nx addon (rating bonus, synced story_tag/status_tag)
             +--- Nx vignette (consequences)

Journey --------- Nx vignette (one marked generalConsequences)
```

**Fellowship singleton:** exactly one fellowship actor per world, stored in `LitmSettings.fellowshipId`. On `ready`, the system ensures it exists and auto-links all heroes; duplicates are blocked via `preCreateActor`/`preDeleteActor`.

### Sheet Inheritance

Typed sheets inherit through `LitmSheetMixin` → `LitmActorSheet` (items: `LitmItemSheet`); each has a `Landscape` variant. Challenge & Journey also mix in `TagStringSyncMixin`.

All actor sheets support **dual modes** (Play/Edit, `E` keybinding) — sheets switch templates by overriding `_getEditModeTemplate()` and `_configureRenderParts()`. Action handlers are private static methods referenced by string key in `DEFAULT_OPTIONS.actions`.

### Roll Flow

```
HeroSheet roll → LitmRollDialog (tag selection)
  → calculatePower()
  → new LitmRoll("2d6 + {power}", ...)  -- DoubleSix term maps d12 → 2d6 range
  → ChatMessage rendered, "litm.roll" hook fires (auto-scratch, gain improvements)
  → socket broadcast resets dialogs on all clients
```

The dialog's `#selectionMap` is the source of truth for tag selections, not form fields.

### Sockets

Namespace `system.litmv2`. Events cover roll-dialog sync, GM moderation, GM-proxied mutation of unowned documents (scratch, apply success/status, hero creation), story tags, and camping. Canonical list and payload shapes: `modules/system/sockets.js` — read it rather than guessing an event name.

## Active Effects: the canonical tag store

Each effect has a `type` mapping to a TypeDataModel in `modules/active-effects/`. Effects are the canonical data store for all tags and statuses — never a separate `system.tags` array on actors. See the Tag Taxonomy table above for the type matrix.

**ScratchableMixin** (`scratchable-mixin.js`) — adds `isSuppressed` (returns `isScratched`; Foundry skips suppressed effects) and `toggleScratch()`. Used by `power_tag`, `fellowship_tag`, `relationship_tag`, `story_tag`.

**Tag access rules**:

1. Actor-level queries → `allApplicableEffects()`, never `actor.effects`
2. Item-level queries → `item.effects` directly
3. Resolve an effect → `allApplicableEffects()` search, or `resolveEffect()` in `effect-queries.js`
4. Mutate an effect → use `effect.parent` for the correct document; `updateEffectsByParent(actor, updates)` groups updates by parent
5. Never set `transfer: true` explicitly — it's the Foundry default for item-parented effects
6. Use `HeroData` getters (`themes`, `storyTags`, `statusEffects`, `fellowship`, `scratchedTags`, …) instead of manual traversal
7. `actor.system.addStatus(name, {tier})` is the canonical "this actor gains a status" entry (stacks case-insensitively)

**Dual representation (Challenge/Journey)**: `system.tags` string is canonical in edit mode, ActiveEffects in play mode. `TagStringSyncMixin` synchronizes on mode switch.

**Addon items**: `syncAddonEffects` parses addon `system.tags`, creates effects flagged with `flags.litmv2.addonId`. `resyncAddonEffects` deletes and recreates on update.

**Never hand-build effect creation data.** `effect-factories.js` has a factory per tag type; `parseTagStringMatch()` (`modules/item/action/tag-string.js`) converts a `CONFIG.litmv2.tagStringRe` match into AE creation data.

## Key Conventions

### Native Foundry first

- **Dialogs:** `foundry.applications.api.DialogV2` (not legacy `Dialog`)
- **Template rendering:** `foundry.applications.handlebars.renderTemplate()`
- **Tabs:** Foundry's native tab system (`static TABS`, `tabGroups`, `changeTab()`, `data-action="tab"`) — never hand-roll tab switching JS. For dynamic tabs, set `cssClass` per tab in `_prepareContext`.
- **CSS:** Foundry utility classes (`.flexrow`, `.flexcol`, `.scrollable`, `.standard-form`, `.form-group`, `.hint`, `.gap-*`) and Foundry CSS vars before custom styles

**Gotcha:** `<button>` in a `<form>` defaults to `type="submit"`. Always use `type="button"` for non-submit buttons in `tag: "form"` ApplicationV2 apps.

### Template paths

All Handlebars paths prefixed with `systems/litmv2/`. Same for partials: `{{> "systems/litmv2/templates/partials/play-tag.html"}}`.

### Localization

All user-facing strings go through `lang/en.json`. Use `localize` (alias `t`) from `modules/utils.js`.

**Only add keys to `en.json`.** Foundry falls back to English for missing keys — that's the signal to translators. Don't translate yourself.

Run `npm run i18n:check` after touching UI strings or templates. It catches missing keys, superfluous keys, and hardcoded placeholders. If you add a new dynamic-key pattern the script doesn't recognize, extend the patterns in `scripts/lang-check-keys.js`.

### Logging

Import from `modules/logger.js` instead of bare `console.*`:

```js
import { error, warn, info, success } from "../logger.js";
```

Exception: `.catch(console.error)` is fine — the logger loses stack traces.

### Data migrations

**First ask whether a migration is needed at all.** Prefer a root fix — a guard in the
data model (`migrateData`, `_preCreate`, an invariant in `prepareDerivedData`) — over
migrating stored data. Propose `migrations.js` work only when bad data already exists
in worlds and can't be normalized on load.

Prefer `static migrateData(source)` in DataModel subclasses (Foundry runs it on document load; idempotent, no version tracking). `modules/system/migrations.js` is reserved for bulk operations migrateData can't handle (renaming doc types, moving data between documents). Always `return super.migrateData(source)` at the end.

### CSS

- `litm--` prefix (BEM-inspired) for system-specific classes
- Use Foundry CSS variables for theme compatibility
- **Don't use** `border-left` as a selection indicator (use background); `dashed`/`dotted` border styles (use solid, or `groove`/`ridge`)

### Custom System Hooks

- `litm.preRoll` / `litm.roll` — before/after roll submission
- `litm.rollDialogRendered` / `litm.rollDialogClosed` — dialog lifecycle
- `litm.preTagScratched` / `litm.tagScratched` — tag scratch lifecycle
- `litm.themeAdvanced` — after theme advancement
- `litm.trackCompleted` — `{ actor, trackInfo: { text, type, actorId?, themeId? } }`
- `litm.limitReached` — `{ actor, limit }` where `limit.max` is the effective max
- `litm.sceneTagsChanged` — after any story-tag-sidebar CRUD (scene tags, actor tags/statuses, limits); no payload. Roll dialogs listen to refresh contributed-tag groups.

Hooks registered via `LitmHooks.register()` in `modules/system/hooks/index.js`, delegating to domain modules (`actor-hooks`, `chat-hooks`, `item-hooks`, `fellowship-hooks`, `ui-hooks`, `token-hooks`, `ready-hooks`, `compat-hooks`, `preloads`). Add new hooks to the appropriate domain file.

### Asset preloads

New `.webp` assets must be added to the `preloads` array in `LitmConfig`. All images use `.webp`; icons use `.svg`.

## Design System

The system has a fully-implemented visual identity — **not aspirational**. New UI
must match it. Full detail (tokens, patterns, composition recipes, anti-references)
lives in `.claude/rules/design-system.md`, which auto-loads for `templates/**`,
`*.css`, and the `sheets`/`apps`/`components`/`renderers` modules.

**Read that rule before writing any UI, template, or CSS.** If you catch yourself
writing inline `style="..."` or `border-radius: 999px`, stop — there is a litm
token or class for it.
