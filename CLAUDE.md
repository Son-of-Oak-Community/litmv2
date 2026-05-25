# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About

Legend in the Mist is a Foundry Virtual Tabletop (v14 minimum) system for a rustic fantasy RPG based on the Mist Engine. The system id is `litmv2`. Pure ES modules -- no build step, no bundler.

## Extensibility

The system aims to be **extensible and malleable**. Module authors and world-level macros should be able to change behaviour by replacing classes or overriding hooks rather than forking the system. When refactoring, **preserve the public API surface** — do not strip aliases from `game.litmv2` or remove published hooks/CONFIG slots even when they look unused internally.

The two public extension surfaces are:

- **`game.litmv2`** (see `litmv2.js`) — replaceable classes (`LitmRoll`, `LitmRollDialog`, `WelcomeOverlay`, `StoryTagApp`, `SpendPowerApp`, `ApplyActionMenuApp`, `ThemeAdvancementApp`), data model classes under `data.*`, `methods.calculatePower`, the singleton `fellowship` getter, and `ContentSources`. Reassigning these at module startup is the supported way to alter system behaviour.
- **`CONFIG.litmv2`** (see `modules/system/config.js`) — `roll.{formula,resolver}` (third-party roll formula/resolution override), `heroLimit`, theme tiers, asset paths, `THEME_TAG_TYPES`/`POWER_TAG_TYPES`, the tag-string regex source.

The custom system hooks (`litm.preRoll`, `litm.roll`, `litm.tagScratched`, etc., listed under "Custom System Hooks" below) are the third extension surface: prefer adding a new `litm.*` hook over hard-wiring a callback.

Concretely: want to change how power is calculated? Reassign `LitmRoll.calculatePower` (or override `CONFIG.litmv2.roll.resolver`). Want a custom welcome flow? Replace `game.litmv2.WelcomeOverlay`. New code that adds a behaviour third-parties might want to swap should expose it as a class on `game.litmv2`, a config slot on `CONFIG.litmv2`, or a `litm.*` hook — not as a private helper.

## Commands

- `npm test` -- run the Vitest unit-test suite
- `npm run i18n:check` -- find missing/superfluous localization keys (wraps `scripts/lang-check-keys.js`)
- `npm run i18n:diff` -- diff each non-English language file against `lang/en.json` (wraps `scripts/lang-diff.js`)

## Architecture

### Boot Sequence (`litmv2.js`)

1. **Module load** -- `SuperCheckbox.Register()` registers the custom element before any hooks
2. **`init`** -- Registers data models, settings, dice, config, sheets, helpers, hooks, token HUD, and replaces combat tracker with `StoryTagSidebar`
3. **`i18nInit`** -- Registers text enrichers (needs localized strings)
4. **`ready`** -- Runs world migrations, seeds statuses, loads status compendium, registers socket listeners, aliases `game.litmv2.storyTags = ui.combat`

### Directory Structure

```
modules/
  actor/                    # Actor data models + sheets (hero, challenge, journey, fellowship, story-theme)
    mixins/                 # Cross-actor protocols: EffectTagsMixin, LimitsMixin, actor-limits helpers
  item/                     # Item data models + sheets (theme, story-theme, backpack, themebook, vignette, trope, addon)
  apps/                     # Standalone ApplicationV2 apps
    roll/                   # roll, roll-dialog, roll-pipeline, roll-dialog-context, roll-request
    welcome/                # welcome-overlay, hero-creation-data
    story-tags/             # story-tag-sidebar, story-tag-helpers, scene-tag-dialog
    (flat)                  # spend-power, theme-advancement, actions-app, apply-action-menu, target-picker, dice, etc.
  active-effects/           # AE type data models, custom AE document, AE sheet, scratchable mixin
  sheets/                   # Base sheet classes + mixins + landscape variants
  system/                   # Infrastructure (config, settings, sockets, migrations, hooks/, renderers/)
    hooks/                  # Domain-specific hook modules (actor, chat, fellowship, item, token, ui, compat, preloads, ready)
  components/               # Custom HTML elements (SuperCheckbox)
  hud/                      # Custom token HUD
  utils.js                  # Cross-cutting helpers: localization, pack queries, enrichHTML, linked-ref navigation
  logger.js                 # Color-coded console logging
templates/                  # Handlebars templates (actor/, item/, chat/, apps/, effect/, hud/, partials/)
lang/                       # Localization files (en, de, es, cn, fr, no)
assets/                     # Fonts (.woff2), images (.webp), icons (.svg)
packs/                      # Compendium packs (status-effects)
```

### Document Type Map

| Document | Types | Data Model Location |
|----------|-------|---------------------|
| **Actor** | `hero`, `journey`, `challenge`, `fellowship`, `story_theme` | `modules/actor/{type}/{type}-data.js` |
| **Item** | `theme`, `themebook`, `trope`, `backpack`, `story_theme`, `vignette`, `addon` | `modules/item/{type}/{type}-data.js` |
| **ActiveEffect** | `power_tag`, `weakness_tag`, `fellowship_tag`, `relationship_tag`, `story_tag`, `status_tag` | `modules/active-effects/{type}-data.js` |

Custom document classes: `LitmItem` (`modules/item/litm-item.js`) handles legacy tag-to-effect migration. `LitmActiveEffect` (`modules/active-effects/litm-active-effect.js`) is the custom AE document class.

### Sheet Inheritance

```
HandlebarsApplicationMixin(ActorSheetV2)
  -> LitmSheetMixin(...)
       -> LitmActorSheet              # MODES (PLAY/EDIT), _updateEmbeddedFromForm
             HeroSheet             + HeroSheetLandscape
             ChallengeSheet        + ChallengeSheetLandscape    (+ TagStringSyncMixin)
             JourneySheet          + JourneySheetLandscape      (+ TagStringSyncMixin)
             FellowshipSheet       + FellowshipSheetLandscape
             StoryThemeActorSheet

HandlebarsApplicationMixin(ItemSheetV2)
  -> LitmSheetMixin(...)
       -> LitmItemSheet
             ThemeSheet, StoryThemeSheet, BackpackSheet,
             ThemebookSheet, VignetteSheet, TropeSheet, AddonSheet
```

Action handlers are **private static methods** on sheet classes, referenced by string key in `DEFAULT_OPTIONS.actions`. ApplicationV2 binds `this` to the sheet instance at call time.

All actor sheets support **dual modes** -- Play (read-only) and Edit (full editing), togglable via the `E` keybinding. Sheets switch templates by overriding `_getEditModeTemplate()` and `_configureRenderParts()`.

### Actor-Item Relationships

```
Hero ---+--- 4x theme (with power_tag/weakness_tag effects)
        +--- 1x backpack (with story_tag effects, transfer: true)
        +--- fellowshipId ---> Fellowship (singleton)
                                  +--- 1x theme (isFellowship=true, with fellowship_tag effects)
                                  +--- Nx story_theme

Challenge ---+--- Nx addon (rating bonus, with synced story_tag/status_tag effects)
             +--- Nx vignette (consequences)

Journey --------- Nx vignette (one marked generalConsequences)
```

**Fellowship singleton:** Exactly one fellowship actor per world, stored in `LitmSettings.fellowshipId`. On `ready`, the system ensures the singleton exists and auto-links all heroes. Creation/deletion of duplicates is blocked via `preCreateActor`/`preDeleteActor` hooks.

### Roll Flow

```
User clicks Roll (Hero Sheet)
  -> HeroSheet opens LitmRollDialog
  -> User selects tags (positive / negative / scratched)
  -> calculatePower():
       power = scratched*BURN_POWER + powerTags - weaknessTags
             + maxPositiveStatus - maxNegativeStatus
             + modifier + might + tradePower
  -> new LitmRoll("2d6 + {power}", ...)
  -> evaluate() using DoubleSix term (d12 mapped to 2d6 range via Math.ceil(total / 2))
  -> outcome: consequences / success-and-consequences / success
  -> toMessage() -> ChatMessage with rendered template
  -> Hook "litm.roll" -> auto-scratch, gain improvements
  -> Socket broadcast -> reset dialogs on all clients
```

Roll dialog `#selectionMap` is the source of truth for tag selections, not form fields.

### Multiplayer (Sockets)

Eleven socket events on `system.litmv2`:

| Event | Purpose |
|-------|---------|
| `updateRollDialog` | Sync roll dialog state across clients |
| `requestRollDialogSync` | Request current dialog state from owner |
| `resetRollDialog` | Clear dialog after roll completes |
| `closeRollDialog` | Close dialog on all clients |
| `rollDice` | GM broadcasts approved roll to player (moderation) |
| `rejectRoll` | GM rejects roll, reopens dialog |
| `storyTagsUpdate` | Sync story tag sidebar state |
| `storyTagsRender` | Trigger sidebar re-render on all clients |
| `campingOpen` | Broadcast that a camping scene was opened on one client |
| `campingSaveOp` | Non-GM clients dispatch a named state mutation (`{ key, payload }`); GM applies it atomically against current flag |
| `campingEnd` | Broadcast that camping was finalized + closed |

### Standalone Applications

| Class | File | Purpose |
|-------|------|---------|
| LitmRollDialog | `modules/apps/roll/roll-dialog.js` | Tag selection, power calculation, roll submission |
| LitmRoll | `modules/apps/roll/roll.js` | Roll formula, outcome resolution, chat display |
| StoryTagSidebar | `modules/apps/story-tags/story-tag-sidebar.js` | Scene tags, effects UI (replaces combat tracker) |
| SpendPowerApp | `modules/apps/spend-power.js` | Post-roll power spending dialog |
| ThemeAdvancementApp | `modules/apps/theme-advancement.js` | Quest/improvement advancement UI |
| WelcomeOverlay | `modules/apps/welcome/welcome-overlay.js` | First-time setup wizard |
| DoubleSix | `modules/apps/dice.js` | Custom d12-to-2d6 dice term |

### System Infrastructure

| Module | File | Purpose |
|--------|------|---------|
| LitmConfig | `modules/system/config.js` | Theme tiers, `BURN_POWER` constant, roll formula overrides, asset paths, regex patterns, `THEME_TAG_TYPES`/`POWER_TAG_TYPES` sets |
| LitmSettings | `modules/system/settings.js` | World/client settings with static getter/setter accessors |
| Sockets | `modules/system/sockets.js` | Socket event dispatch and handler registration |
| Migrations | `modules/system/migrations.js` | Sequential world-migration system (prefer `migrateData()` in DataModels) |
| Enrichers | `modules/system/enrichers.js` | `@render`, `@banner`, `@might`, `[tag]` text enrichers |
| Handlebars | `modules/system/handlebars.js` | Template helpers (`add`, `progress-buttons`, `toJSON`, `join`) and partials |
| Fonts | `modules/system/fonts.js` | Custom font registration (Ysgarth, Luminari, Labrada, Fraunces, etc.) |
| KeyBindings | `modules/system/keybindings.js` | `E` (toggle edit), `Alt+T` (wrap tag markup), `T` (toggle sidebar), `F` (fellowship sheet), `R` (dice roller) |
| Renderers | `modules/system/renderers/` | Document-to-HTML renderers for `@render` enricher |
| Chat | `modules/system/chat.js` | Track completion detection and chat message builders |
| ContentSources | `modules/system/content-sources.js` | Compendium pack management and status seeding |
| Logger | `modules/logger.js` | Styled `error`, `warn`, `info`, `success` wrappers -- use instead of bare `console.*` |
| LitmItem | `modules/item/litm-item.js` | Custom Item class with legacy tag-to-effect migration |
| LitmActiveEffect | `modules/active-effects/litm-active-effect.js` | Custom ActiveEffect document class |
| SuperCheckbox | `modules/components/super-checkbox.js` | `<litm-super-checkbox>` -- cycles: "" -> positive -> negative -> scratched |

## Game Concepts

Legend in the Mist is a tag-based RPG. Instead of numeric stats, characters are defined by short descriptors called **tags**. Tags define what's true in the story and add or reduce the **Power** of a Hero's actions.

### Tag Taxonomy

**Power Tags** -- Permanent positive tags on a Hero's themes. +1 Power when invoked. Can be **scratched** (temporarily unavailable) or **burned** (+3 Power then scratched). "Burn" is a roll-time action; "scratched" is the resulting persistent state. There is no "burned" state on a tag.

**Weakness Tags** -- Permanent negative tags on a Hero's themes. -1 Power when invoked. Invoking marks **Improve** on its theme (the primary advancement mechanic). Cannot be scratched.

**Story Tags** -- Temporary tags gained during play. +1 or -1 Power depending on context. Can be burned for +3 Power. Created or scratched by spending 2 Power. Variants: **single-use** (scratched after one invocation, cannot be burned), **consumable** (burned when fully consumed for +3).

**Statuses** -- Tags with a **tier** (1-6) measuring intensity. Only the highest positive and highest negative status count toward a roll. Stack when reapplied (mark new tier; if box occupied, shift right). Related to **Limits** -- when a status reaches a Limit tier, the target is overcome.

**Fellowship Power Tags** -- Single-use power tags on the shared Fellowship theme. Cannot be burned. Shared across all Heroes.

**Relationship Tags** -- Single-use story tags each Hero has for each other Hero. Renewed during camp/sojourn.

**Story Theme Tags** -- Story tags elevated into a mini-theme with positive and negative tags. Impermanent (entire theme can be removed).

### Enricher Tag Syntax

Prose text supports five bracketed shapes that render as inline chips:

- `[name]`   → story tag
- `[name!]`  → single-use story tag
- `[name-N]` → status tier N (or `[name-]` for tier-less)
- `[name:N]` → limit (max N), or `[name:]` for unbounded
- `[-name]`  → weakness chip (draggable onto a theme/story_theme sheet to create a `weakness_tag` effect)

`[-name]` and `[name:N]` are **enricher-only** — they render styled chips but do not flow through the AE-creation parser in `modules/item/action/tag-string.js`. Weakness chips become real effects only via the theme-sheet drop handler.

### Power Calculation

- +1 per helpful (positive) tag
- -1 per hindering (negative) tag
- +tier of highest helpful status
- -tier of highest hindering status
- +3 for one burned tag (max one per roll)
- +/-3 or +/-6 for Might difference

### Spending Power (Detailed Outcomes)

- **Add/recover/scratch a tag**: 2 Power
- **Give/reduce a status**: 1 Power per tier
- **Discover a valuable detail**: 1 Power
- **Extra feat**: 1 Power (only after main purpose spent)
- **Single-use tag** (with last 1 Power): 1 Power

## Active Effects

Active Effects are the **canonical data store** for all tags and statuses. Each effect has a `type` that maps to a TypeDataModel subclass in `modules/active-effects/`.

### Effect Types

#### `power_tag` (lives on: theme/story_theme items)

Fields: `question` (String, nullable), `isScratched` (Boolean), `isTitleTag` (Boolean). Uses `ScratchableMixin` for `toggleScratch()` and `isSuppressed`. `disabled` field encodes unlocked/active state.

Getters: `canBurn` -> `!this.isScratched`, `allowedStates` -> `",positive,scratched"`, `defaultPolarity` -> `1`

#### `weakness_tag` (lives on: theme/story_theme items)

Fields: `question` (String, nullable). No scratch support. `disabled` encodes unlocked/active.

Getters: `canBurn` -> `false`, `allowedStates` -> `",negative,positive"`, `defaultPolarity` -> `-1`

#### `fellowship_tag` (lives on: fellowship theme item)

Fields: `question` (String, nullable), `isScratched` (Boolean), `isTitleTag` (Boolean). Uses `ScratchableMixin`. Always single-use (`isSingleUse` getter returns `true`), cannot be burned.

Getters: `canBurn` -> `false`, `allowedStates` -> `",positive"`, `defaultPolarity` -> `1`

#### `relationship_tag` (lives on: hero actors directly)

Fields: `targetId` (String), `isScratched` (Boolean). Uses `ScratchableMixin`. Always single-use (`isSingleUse` getter returns `true`).

Getters: `canBurn` -> `false`, `allowedStates` -> `",positive,negative"`, `defaultPolarity` -> `1`

#### `story_tag` (lives on: backpack items with transfer, or directly on actors)

Fields: `isScratched` (Boolean), `isSingleUse` (Boolean), `isHidden` (Boolean), `limitId` (String, nullable). Uses `ScratchableMixin`.

Getters: `canBurn` -> `!this.isSingleUse && !this.isScratched`, `allowedStates` -> varies by `isSingleUse`, `defaultPolarity` -> `null`

#### `status_tag` (lives on: actors directly)

Fields: `tiers` (Boolean[6]), `isHidden` (Boolean), `limitId` (String, nullable). No scratch support.

Getters: `canBurn` -> `false`, `allowedStates` -> `",positive,negative"`, `defaultPolarity` -> `null`, `currentTier`, `value`

Static methods: `markTier(tiers, tier)`, `stackTiers(tierArrays)`. Instance: `calculateMark(tier)`, `calculateReduction(amount)`.

### Type Summary

| Type | Lives On | Transfers? | Polarity | Single-Use | Can Burn |
|------|----------|-----------|----------|-----------|---------|
| `power_tag` | theme/story_theme items | No | Always +1 | No | Yes (+3) |
| `weakness_tag` | theme/story_theme items | No | Always -1 | No | No |
| `fellowship_tag` | fellowship theme item | No | Always +1 | Yes | No |
| `relationship_tag` | hero actors | N/A | +1 default | Yes | No |
| `story_tag` | backpack items / actors | Yes (backpack) | Context | Optional | Yes |
| `status_tag` | actors | No | Context | N/A | N/A |

### ScratchableMixin (`modules/active-effects/scratchable-mixin.js`)

Adds `isSuppressed` getter (returns `this.isScratched` -- Foundry skips suppressed effects) and `toggleScratch()` method. Used by `power_tag`, `fellowship_tag`, `relationship_tag`, `story_tag`.

### Effect Routing

Effects can live on actors or embedded items. Updates must be routed to the correct parent document.

- **`updateEffectsByParent(actor, updates)`** -- resolves each effect via `allApplicableEffects()`, groups by `.parent`, calls `updateEmbeddedDocuments` per group
- **`_updateEmbeddedFromForm(submitData)`** on actor sheets -- parses `effects.<id>.<field>` keys from form data, normalizes special cases, routes through `updateEffectsByParent`

### Effect Lifecycle

- **Theme sheets**: `item.createEmbeddedDocuments("ActiveEffect", [powerTagEffect(...)])` / `weaknessTagEffect(...)`
- **Backpack sheets**: `item.createEmbeddedDocuments("ActiveEffect", [{ ...storyTagEffect(...), transfer: true }])`
- **Actor sheets**: `_onAddStoryTag` routes heroes through backpack with `transfer: true`, others directly on actor
- **Challenge/Journey** (`TagStringSyncMixin`): Dual representation -- `system.tags` string (canonical in edit mode) and ActiveEffects (canonical in play mode). Mixin synchronizes between them on mode switch.
- **Addon items**: `syncAddonEffects` parses addon's `system.tags` string, creates effects flagged with `flags.litmv2.addonId`. `resyncAddonEffects` deletes and recreates on addon update.

### EffectTagsMixin (`modules/actor/mixins/effect-tags-mixin.js`)

Mixin for actor data models providing: `storyTags` (all `story_tag` effects), `statusEffects` (all `status_tag` effects), `addStoryTag(effectData)` (override point for routing), `addStatus(name, {tier, tiers, img, isHidden, limitId})`, `removeStatus(effectId)`. Uses `allApplicableEffects()` internally. `addStatus` is the canonical "this actor gains a status" entry point: it stacks (via `calculateMark`) onto a case-insensitive same-named existing status before creating a new one.

### HeroData Getters (`modules/actor/hero/hero-data.js`)

- `fellowshipActor` -- linked fellowship actor (falls back to singleton)
- `themes` -- `[{ theme: Item, tags: ActiveEffect[] }]` own non-fellowship themes
- `backpack` / `backpackItem` -- story tags on the hero's backpack item
- `storyTags` -- all `story_tag` effects via `allApplicableEffects()`
- `statusEffects` -- all `status_tag` effects (from `EffectTagsMixin`)
- `fellowship` -- `{ themes, tags }` from the linked fellowship actor
- `scratchedTags` -- all scratched AEs across hero + fellowship

## Key Conventions

### Prefer Native Foundry Behaviour

Always use Foundry's built-in APIs instead of hand-rolling solutions. A symlink to the current Foundry source is at `./foundry/` (client code under `public/`, CSS at `public/css/foundry2.css`). API docs: <https://foundryvtt.com/api/v14/>

- **Dialogs:** `foundry.applications.api.DialogV2` (not legacy `Dialog`)
- **Template rendering:** `foundry.applications.handlebars.renderTemplate()`
- **Tabs:** Use Foundry's native tab system via `static TABS`, `tabGroups`, `changeTab()`, and `data-action="tab"` -- never hand-roll tab switching JS
- **CSS:** Use Foundry utility classes (`.tabs`, `.flexrow`, `.flexcol`, `.scrollable`) and CSS variables before writing custom styles

**Gotcha:** `<button>` inside a `<form>` defaults to `type="submit"`. Always use `type="button"` for non-submit buttons in ApplicationV2 apps with `tag: "form"`.

### Tag Access Model

**Access rules:**

1. **Actor-level queries** (all tags on a character) -> use `allApplicableEffects()`, never `actor.effects`
2. **Item-level queries** (tags on a specific theme) -> use `item.effects` directly
3. **Finding an effect by ID** -> search `allApplicableEffects()` or use `resolveEffect()` from `modules/active-effects/effect-queries.js`
4. **Mutating an effect** -> resolve via `allApplicableEffects()`, use `effect.parent` for the correct document
5. **Never set `transfer: true` explicitly** -- it's the Foundry default for item-parented effects

Use `HeroData` getters instead of manually traversing items/effects.

### Template Paths

All Handlebars template paths are prefixed with `systems/litmv2/`:

```javascript
template: "systems/litmv2/templates/actor/hero.html"
// In partials
{{> "systems/litmv2/templates/partials/play-tag.html"}}
```

### Localization

All user-facing strings use keys from `lang/en.json`. Use the `localize` utility (aliased as `t`) from `modules/utils.js`:

```javascript
import { localize as t } from "../utils.js";
```

When adding new keys, add them to all language files (`npm run i18n:diff` or `npm run i18n:check` to find gaps).

### CSS Class Naming

System-specific classes use `litm--` prefix (BEM-inspired). Use Foundry's built-in utility classes for layout. Prefer Foundry CSS variables (`--color-text-primary`, `--color-border`) over hardcoded values for theme compatibility.

**CSS anti-patterns -- do not use:**

- `border-left` as a selection/active indicator -- use background color changes instead
- `dashed` or `dotted` border styles -- use `solid` borders, or `groove`/`ridge` for decorative separators

### Logging

Use the system logger (`modules/logger.js`) instead of bare `console.log/warn/error`:

```javascript
import { error, warn, info, success } from "../logger.js";
```

**Exception:** `.catch(console.error)` callbacks are acceptable since the logger loses Error stack traces.

### Dynamic Tabs

For **dynamic tabs** (e.g., generated from data at render time), manually manage `tabGroups` and set `cssClass` on each tab entry in `_prepareContext`:

```javascript
this.tabGroups["my-group"] ??= dynamicTabs[0]?.id;
for (const tab of dynamicTabs) {
  tab.cssClass = this.tabGroups["my-group"] === tab.id ? "active" : "";
}
```

Template markup -- nav buttons use `data-action="tab"`, content sections use `class="tab"`:

```html
<nav class="tabs" data-group="my-group">
  {{#each tabs}}
  <button type="button" class="item {{cssClass}}" data-action="tab" data-group="my-group" data-tab="{{id}}">{{label}}</button>
  {{/each}}
</nav>
<section class="tab {{tab.cssClass}}" data-group="my-group" data-tab="tab1">...</section>
<section class="tab {{tab.cssClass}}" data-group="my-group" data-tab="tab2">...</section>
```

Foundry's `changeTab()` handles all switching, active-class toggling, and state persistence automatically. No custom JS event listeners needed.

### Data Migrations

Prefer `static migrateData(source)` in DataModel subclasses for data shape changes. Foundry calls `migrateData` automatically on document load -- transparent, idempotent, no version tracking. Always call `return super.migrateData(source)` at the end.

`modules/system/migrations.js` is only for bulk operations that `migrateData` can't handle (e.g., renaming document types, moving data between documents).

### Settings (`modules/system/settings.js`)

`LitmSettings.register()` registers world and client settings with static getter/setter accessors:

**World:** `welcomed`, `storytags`, `systemMigrationVersion`, `fellowshipId`, `heroLimit`, `useFellowship`, `statusesSeeded`, compendium source arrays (`compendium.themebooks`, `compendium.themekits`, `compendium.tropes`, `compendium.statuses`)

**Client:** `customDice`, `popoutTagsSidebar`

### Effect Factory Functions (`modules/active-effects/effect-factories.js`)

Use factory functions to create properly-shaped effect data: `powerTagEffect()`, `weaknessTagEffect()`, `fellowshipTagEffect()`, `relationshipTagEffect()`, `storyTagEffect()`, `statusTagEffect()`. For case-insensitive stack-or-create on a status, call `actor.system.addStatus(name, { tier })` (see [EffectTagsMixin](#effecttagsmixin-modulesactormixinseffect-tags-mixinjs)). Use `updateEffectsByParent(actor, updates)` to route batched effect updates to the correct parent document.

### Effect Query Functions (`modules/active-effects/effect-queries.js`)

Read-only queries over an actor's applicable effects: `isEffectVisible(effect)`, `effectToPlain(effect)`, `partitionEffects(actor, ...types)`, `findApplicableEffect(actor, predicate)`, `resolveEffect(effectId, actor, {fellowship})`. All read through `allApplicableEffects()`, not `actor.effects`.

### Tag-String Parsing (`modules/item/action/tag-string.js`)

`parseTagStringMatch(match)` converts a `CONFIG.litmv2.tagStringRe` match into ActiveEffect creation data. Used by addon-effect sync, the story-tag drop handler, and renderer chip pipeline.

### Utility Functions (`modules/utils.js`)

- `localize(...keys)` (alias `t`) -- `game.i18n.localize()` wrapper
- `queryItemsFromPacks({ type, filter, indexFields, map })` -- queries world items and compendium packs
- `findThemebookByName(name)` -- searches world items then compendium packs
- `enrichHTML(text, document)` -- `TextEditor.enrichHTML()` wrapper with owner-aware secrets
- `confirmDelete(string)` -- `DialogV2.confirm()` prompt; returns `false` on cancel/close
- `toQuestionOptions(questions, skipFirst)` -- maps question arrays to letter-indexed options
- `parseEmbeddedFormKeys()` -- extracts nested document updates from form data
- `openLinkedRef(uuid)` / `viewLinkedRefAction(event, target)` / `getLinkedRefName(uuid)` -- linked-ref UUID navigation
- `transferBackpackTags(source, target, ids)` / `removeAtIndex(doc, path, index)` -- document mutation helpers
- `getStoryTagSidebar()` -- accessor for the story-tag sidebar instance

### Custom System Hooks

- `litm.preRoll` / `litm.roll` -- before/after roll submission
- `litm.rollDialogRendered` / `litm.rollDialogClosed` -- roll dialog lifecycle
- `litm.preTagScratched` / `litm.tagScratched` -- tag scratch lifecycle
- `litm.themeAdvanced` -- after theme advancement
- `litm.trackCompleted` -- after a progress track completes; payload `{ actor, trackInfo }` where `trackInfo` is `{ text, type, actorId?, themeId? }`
- `litm.limitReached` -- after a limit's value crosses its effective max; payload `{ actor, limit }` where `limit` is the full limit object with `max` set to `getEffectiveMax`
- `litm.sceneTagsChanged` -- after any CRUD on scene tags / statuses / limits via the story-tag sidebar; no payload. Open roll dialogs listen for this to refresh their contributed-tag groups

### Hooks Organization

Hooks registered via `LitmHooks.register()` in `modules/system/hooks/index.js`, delegating to domain-specific modules: `actor-hooks.js`, `chat-hooks.js`, `compat-hooks.js`, `fellowship-hooks.js`, `item-hooks.js`, `preloads.js`, `ready-hooks.js`, `ui-hooks.js`, `token-hooks.js`. Add new hooks to the appropriate domain file.

### Asset Preloads

New `.webp` assets must be added to the `preloads` array in `LitmConfig` (`modules/system/config.js`). All images use `.webp` format. Icons use `.svg`.

## Foundry CSS Reference

Foundry V14 provides extensive utility classes and CSS variables. The Foundry source CSS is at `./foundry/public/css/foundry2.css`. Always check the source for current values.

### Layout Utilities

| Class | Description |
|-------|-------------|
| `.flexrow` | `display: flex; flex-direction: row; flex-wrap: wrap; align-items: center;` Children default to `flex: 1` |
| `.flexcol` | `display: flex; flex-direction: column; flex-wrap: nowrap;` Children default to `flex: none` |
| `.flex0` - `.flex3` | Flex growth values 0-3 |
| `.noflex` | `flex: none` |
| `.scrollable` | `overflow: hidden auto` with `scrollbar-gutter: stable` |
| `.hidden` | `display: none !important` |
| `.disabled` | `cursor: default; pointer-events: none;` |
| `.ellipsis` | `white-space: nowrap; text-overflow: ellipsis; overflow: hidden;` |

### Forms (`.standard-form`)

| Class | Description |
|-------|-------------|
| `.standard-form` | Top-level flex column container with `gap` spacing |
| `.form-group` | Container for label + input. Label `flex: 1`, input/fields `flex: 2` |
| `.form-group.stacked` | Children take 100% width |
| `.form-group.inline` | `justify-content: space-between` |
| `.form-group.slim` | Reduced spacing |
| `.form-fields` | Flex container for grouping multiple inputs |
| `.form-footer` | Container for action buttons |
| `.hint` | Small text (`var(--font-size-14)`) |
| `fieldset.input-grid` | CSS Grid layout, default `--grid-cols: 2` |

### Buttons

| Class | Description |
|-------|-------------|
| `button` / `a.button` | Standard flex button with transitions |
| `.bright` | Uppercase, high-contrast action button |
| `.active` | Focus/active state outline |
| `.icon` | Fixed-width icon button (`flex: 0 0 var(--button-size)`) |
| `.plain` | Transparent background and borders |
| `.ui-control` | Small fixed-size control button (32px) |

### Tabs

| Class | Description |
|-------|-------------|
| `nav.tabs` | Flex container with `space-evenly` |
| `nav.tabs.vertical` | Column layout for sidebars |
| `nav.tabs [data-tab].active` | Highlighted active tab |
| `.tab[data-tab]` | Content container, hidden unless `.active` |

### Sheet Structure

| Class | Description |
|-------|-------------|
| `.app` | Base application with backdrop blur and rounded corners |
| `.window-app` | Pop-out window structure |
| `.window-header` | Header with title and controls |
| `.window-content` | Scrollable main content area |
| `.sheet-header` | Flexrow header for profile image and name |
| `.sheet-tabs` | Specialized tab navigation |
| `.sheet-footer` | Bottom action area |

### Key CSS Variables

Foundry V14 uses a warm earth-tone palette. Variables are theme-aware (light/dark via `body.theme-light` / `body.theme-dark`).

**Text:** `--color-text-emphatic`, `--color-text-primary`, `--color-text-secondary`, `--color-text-subtle`

**Layout:** `--spacer-2`, `--spacer-4`, `--spacer-8`, `--spacer-12`, `--spacer-16` (spacing)

**Typography:** `--font-primary` (Signika), `--font-size-11` through `--font-size-24`

**Application:** `--background`, `--color-header-background`, `--color-border`, `--color-tabs-border`, `--color-fieldset-border`

**Forms:** `--color-form-hint`, `--color-form-label`, `--color-form-hint-hover`, `--color-form-label-hover`

**Headings:** `--font-h1` (Modesto Condensed), `--font-h2` (Amiri), `--font-h3` (Signika)

## Design System

The system has a fully-implemented visual identity -- this is **not aspirational**. New UI must match the existing language; do not reach for Foundry defaults when system tokens already exist. When you find yourself writing inline `style="..."` or `border-radius: 999px`, stop -- there is almost certainly a litm token or class for what you want. **Use Foundry's tokens where they exist** (spacing, text colors, font sizes); the litm tokens fill in what Foundry doesn't have (game colors, fonts, custom radii).

### What the system actually looks like

- **Sheets and chat sit on a parchment texture** (`assets/media/sheet-background.webp`) wired into `--background`, `--sidebar-background`, and `--chat-message-background`. New card surfaces should let this show through; don't paint them with `var(--color-header-background)` (Foundry default) -- that creates the flat-grey "admin tool" look that breaks identity.
- **Actor names render in blackletter Ysgarth** at large size (e.g. "Gerrin Deerstalker"). Theme card titles render in serif italic with a `text-stroke` outline in the tag color and a skewed background bar (`transform: skewX(-3deg)`) -- this is the signature **tag chrome**, applied via the `:where(.litm-tag, .litm-power_tag, ...)` rule in `litmv2.css` section 4. Don't reimplement this with plain `<input>` fields or pill `<span>`s; reuse the class.
- **Section headers extend horizontal lines** out from the label (`::before`/`::after` `flex: 1 border-top`) in small-caps, letter-spaced, uppercase, secondary text color. See `.litm-render__section-header` -- the established "manuscript chapter break" treatment. Use this anywhere you want a section label, not a plain `<legend>`.
- **Decorative bullet `✦`** separates power tags in play-mode display.
- **Italic blockquote flavor text** sits inside theme/vignette cards, between header and body.
- **Tracks use `○ ○ ○` empty-circle progress** with custom checkbox SVGs for filled state. See `.progress-box` and `assets/media/checkbox.svg`.

### Design tokens

```
Spacing       --spacer-2/4/8/12/16      (Foundry: 0.125 / 0.25 / 0.5 / 0.75 / 1 rem)
Radius        --border-radius           (4px, default)
              --radius-sm/md/lg/xl      (3 / 6 / 8 / 10 px)
              --radius-pill             (100px)   ← use this, not "999px"
              --radius-circle           (50%)
Shadows       --shadow-sm/md            (drop)
              --shadow-glow/glow-strong (focus/secret reveal)
Transitions   --transition-fast/normal/slow/slower  (0.12 / 0.15 / 0.2 / 0.25 s)
Line height   --line-height-tight/snug/normal/relaxed/loose
Game colors   --color-litm-tag          (#efd693 golden mustard, power/story/fellowship/relationship/theme tags)
              --color-litm-status       (#bcceb1 sage green)
              --color-litm-limit        (#d9b2a9 muted rose)
              --color-litm-weakness     (#edbb89 warm apricot)
              --color-litm-banner       (#c4b5a8 beige plaque)
              --color-litm-track-*      (promise/improve/milestone/abandon/limit accents)
              --color-litm-might-*      (origin/adventure/greatness tier accents)
Alpha tints   --color-warm-1-10/25/50, --color-text-primary-10/15/40, --color-overlay-white-3/5/7/8/10
Fonts         --font-blackletter        (Ysgarth) -- character/sheet titles only
              --font-h2                 (Luminari) -- decorative serif for section/card titles
              --font-h4                 (PowellAntique) -- pause overlay etc.
              --font-luminari/powell/packard/trattatello -- direct refs when needed
              --font-serif              (Labrada → Fraunces fallback) -- body
              --font-blockquote         (Labrada) -- italic flavor text
```

**Foundry tokens to use directly:** `--spacer-2/4/8/12/16` (spacing), `--color-text-primary/secondary/subtle/emphatic`, `--color-form-*`, `--color-border`, `--color-fieldset-border`, `--font-size-11..24`, `--font-monospace`. Foundry layout utilities (`.flexrow`, `.flexcol`, `.flex0/1/2/3`, `.noflex`, `.scrollable`, `.standard-form`, `.form-group`, `.hint`, `.gap-xs/sm/md/lg`) are imported and expected.

**Foundry tokens to avoid:** `--color-header-background` for card surfaces (let the parchment show through; the flat-grey paint reads as "admin tool").

**No local spacing tokens.** Snap every spacing value at or below 1rem to Foundry's `--spacer-2/4/8/12/16` scale. Don't invent `--space-*` aliases. Values above 1rem (large card padding like `1.25rem`, `1.5rem`, `2rem`) are deliberate surface-scale spacing — keep them as raw rem; they're literal layout values, not redefined tokens.

### Established UI patterns -- reuse, don't reinvent

| Pattern | Where to find it | When to use |
|---------|-----------------|-------------|
| **Tag chrome** (gold/sage/rose serif italic with skewed underline) | `:where(.litm-tag, .litm-power_tag, .litm-status, ...)` in CSS section 4 | Any text that represents an in-game tag, even read-only display. Apply the class, set `--tag-color` if needed. |
| **Section header with extending lines** | `.litm-render__section-header` | Section dividers inside cards, sheets, dialogs. Replaces plain `<legend>`. |
| **Manuscript title** (centered Ysgarth uppercase) | `.litm-render__title` | Embed cards, large titles within content. |
| **Embed card base** (2px border, radius-lg, padded, parchment showing through) | `.litm-render--card` | New card-shaped containers in chat or sheets. |
| **Banner plaque** (notched-corner uppercase tablet) | `.litm-banner` | Small status/category labels with weight. |
| **Ingress paragraph** (LuxuriousRoman, subtle color) | `.litm--ingress` | Lead paragraph in long-form description. |
| **Decorative bullet** | `.litm-render` examples | Use ` ✦ ` (U+2726) between inline tag labels in display mode. |

### New-UI checklist

Before adding new CSS or templates, work through this:

1. Is there an established `litm--*` class for this concept? (Check section 4 for tags, sections 5--8 for cards/sheets, section 11 for chat, section 16 for embed cards.)
2. Are spacing values pulled from `--spacer-*` (Foundry), not raw rems?
3. Are radii pulled from `--radius-*`, not raw `4px` or `999px`?
4. Are colors pulled from `--color-litm-*` (game) or `--color-text-*` (Foundry text), not `--color-header-background`?
5. Is body text serif italic where it represents flavor, voice, or in-fiction language? Plain sans is for chrome (buttons, form labels, hints) only.
6. Are inline `style="..."` attributes absent from the template? Use Foundry utilities (`flexrow`, `gap-sm`, `flex0`, `noflex`) and named `litm--*` classes instead.
7. For an icon-button row, does one button stand out as primary? (Larger, labeled, or warmer color -- not just a wall of identical 32px icons.)

### Design principles

1. **Atmosphere through restraint** -- The parchment, gold tags, and serif italic carry the mood. Don't pile on more decoration; trust the existing chrome.
2. **Newcomer-friendly** -- Discoverable interactions, tooltips, consistent patterns. New users need to recognize features by visual analogy to other features.
3. **Reuse before reinvention** -- The system has its own design language; if a new feature doesn't look like the rest, the new feature is wrong, not the system.
4. **Both modes matter** -- Light and dark themes are first-class. Test both. Most game-color tokens are theme-aware; check the `body` and `.themed.theme-light:not(.chat-log)` blocks if adding new ones.
5. **Avoid `color-mix()` workarounds** -- If an alpha tint is needed repeatedly, add it as a `--color-*-NN` token alongside the existing alpha-variant block; don't sprinkle `color-mix()` calls.
