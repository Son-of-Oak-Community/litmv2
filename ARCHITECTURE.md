# Architecture Overview

Legend in the Mist (litmv2) is a Foundry Virtual Tabletop v14 system for a rustic fantasy RPG based on the Mist Engine.

## Boot Sequence

**Entry point: `litmv2.js`**

1. **Module load** — `SuperCheckbox.Register()` registers the custom element before any hooks
2. **`init`** — Registers data models, settings, dice, config, sheets, helpers, and hooks
3. **`i18nInit`** — Registers text enrichers (needs localized strings)
4. **`ready`** — Runs world migrations, registers socket listeners, aliases `game.litmv2.storyTags`

## Directory Structure

```
scripts/
├── actor/                    # Actor data models + sheets (hero, challenge, journey, fellowship)
├── item/                     # Item data models + sheets (theme, story-theme, backpack, themebook, vignette, trope, addon)
├── apps/                     # Standalone ApplicationV2 apps (roll dialog, roll, sidebar, etc.)
├── data/                     # Shared data models (TagData, ActiveEffect types)
├── sheets/                   # Base sheet classes + mixin + landscape variants
├── system/                   # Infrastructure (config, settings, sockets, migrations, hooks/, renderers/)
│   └── hooks/                # Domain-specific hook modules (actor, chat, fellowship, item, ui, compat, preloads, ready)
├── components/               # Custom HTML elements (SuperCheckbox)
├── utils.js                  # Effect factories, localization, pack queries, enrichHTML
└── logger.js                 # Color-coded console logging
templates/                    # Handlebars templates (actor/, item/, chat/, apps/, partials/)
lang/                         # Localization files (en, de, es, cn, no)
assets/                       # Fonts (.woff2), images (.webp), icons (.svg)
packs/                        # Compendium packs (status-effects)
tests/e2e/                    # Playwright E2E tests
```

## Document Type Map

| Document | Types | Data Model Location |
|----------|-------|---------------------|
| **Actor** | `hero`, `journey`, `challenge`, `fellowship` | `scripts/actor/{type}/{type}-data.js` |
| **Item** | `theme`, `themebook`, `trope`, `backpack`, `story_theme`, `vignette`, `addon` | `scripts/item/{type}/{type}-data.js` |
| **ActiveEffect** | `story_tag`, `status_card`, `theme_tag` | `scripts/data/active-effect-data.js` |

## Sheet Inheritance

```
HandlebarsApplicationMixin(ActorSheetV2)
  └── LitmSheetMixin(...)
        └── LitmActorSheet              # MODES (PLAY/EDIT), _updateEmbeddedFromForm
              ├── HeroSheet             + HeroSheetLandscape
              ├── ChallengeSheet        + ChallengeSheetLandscape
              ├── JourneySheet          + JourneySheetLandscape
              └── FellowshipSheet       + FellowshipSheetLandscape

HandlebarsApplicationMixin(ItemSheetV2)
  └── LitmSheetMixin(...)
        └── LitmItemSheet
              ├── ThemeSheet
              ├── StoryThemeSheet
              ├── BackpackSheet
              ├── ThemebookSheet
              ├── VignetteSheet
              ├── TropeSheet
              └── AddonSheet
```

Action handlers are **private static methods** on sheet classes, referenced by string key in `DEFAULT_OPTIONS.actions`. ApplicationV2 binds `this` to the sheet instance at call time.

All actor sheets support **dual modes** — Play (read-only) and Edit (full editing), togglable via the `E` keybinding.

## Actor-Item Relationships

```
Hero ──┬── 4x theme (with theme_tag effects: power/weakness tags)
       ├── 1x backpack (with story_tag effects)
       └── fellowshipId ──> Fellowship (singleton)
                              ├── 1x theme (isFellowship=true)
                              └── Nx story_theme

Challenge ──┬── Nx addon (rating bonus)
            └── Nx vignette (consequences)

Journey ────── Nx vignette (one marked generalConsequences)
```

### Fellowship Singleton

Exactly one fellowship actor per world, stored in `LitmSettings.fellowshipId`. On `ready`, the system ensures the singleton exists and auto-links all heroes. Creation/deletion of duplicates is blocked via `preCreateActor`/`preDeleteActor` hooks.

## Tag System

**TagData** (`scripts/data/tag-data.js`) is the shared schema: `id`, `name`, `question`, `type`, `isActive`, `isScratched`, `isSingleUse`.

Tags originate from three sources:

| Source | Effect Type | Parent |
|--------|------------|--------|
| Theme tags | `theme_tag` | Theme or StoryTheme items |
| Story tags | `story_tag` | Backpack items or actors |
| Status cards | `status_card` | Actors (with 6-tier tracking) |

The **StoryTagSidebar** (replaces Combat Tracker) manages scene-level tags and displays actor effects. It feeds into the roll dialog alongside character tags.

```
Hero.rollableTags = backpack.activeTags
                  + ownThemes.powerTags
                  + fellowshipThemes.powerTags
                  + relationshipTags
```

## Roll Flow

```
User clicks Roll (Hero Sheet)
        |
        v
HeroSheet opens LitmRollDialog
        |
        v
User selects tags (positive / negative / scratched)
        |
        v
calculatePower():
  power = scratched*3 + powerTags - weaknessTags
        + maxPositiveStatus - maxNegativeStatus
        + modifier + might + tradePower
        |
        v
new LitmRoll("2d6 + {power}", ...)
        |
        v
evaluate() using DoubleSix term (d12 mapped to 2d6 range)
        |
        v
outcome: consequences / success-and-consequences / success
        |
        v
toMessage() -> ChatMessage with rendered template
        |
        v
Hook "litm.roll" -> auto-scratch, gain improvements
        |
        v
Socket broadcast -> reset dialogs on all clients
```

**DoubleSix** (`scripts/apps/dice.js`): A custom dice term (denomination `"6"`) that internally rolls a d12 and maps via `Math.ceil(total / 2)` to simulate 2d6.

## Standalone Applications

| Class | File | Purpose |
|-------|------|---------|
| LitmRollDialog | `scripts/apps/roll-dialog.js` | Tag selection, power calculation, roll submission |
| LitmRoll | `scripts/apps/roll.js` | Roll formula, outcome resolution, chat display |
| StoryTagSidebar | `scripts/apps/story-tag-sidebar.js` | Scene tags, effects UI (replaces combat tracker) |
| SpendPowerApp | `scripts/apps/spend-power.js` | Post-roll power spending dialog |
| ThemeAdvancementApp | `scripts/apps/theme-advancement.js` | Quest/improvement advancement UI |
| WelcomeOverlay | `scripts/apps/welcome-overlay.js` | First-time setup wizard |
| DoubleSix | `scripts/apps/dice.js` | Custom d12-to-2d6 dice term |

## Multiplayer (Sockets)

Six socket events on `system.litmv2`:

| Event | Purpose |
|-------|---------|
| `updateRollDialog` | Sync roll dialog state across clients |
| `requestRollDialogSync` | Request current dialog state from owner |
| `resetRollDialog` | Clear dialog after roll completes |
| `rollDice` | GM broadcasts approved roll to player (moderation) |
| `rejectRoll` | GM rejects roll, reopens dialog |
| `storyTagsUpdate` / `storyTagsRender` | Sync story tag sidebar state |

## System Infrastructure

| Module | File | Purpose |
|--------|------|---------|
| LitmConfig | `scripts/system/config.js` | Theme tiers, roll formula overrides, asset paths, regex patterns |
| LitmSettings | `scripts/system/settings.js` | World/client settings with static getter/setter accessors |
| Sockets | `scripts/system/sockets.js` | Socket event dispatch and handler registration |
| Migrations | `scripts/system/migrations.js` | Sequential world-migration system (prefer `migrateData()` in DataModels) |
| Enrichers | `scripts/system/enrichers.js` | `@render`, `@banner`, `@might`, `[tag]` text enrichers |
| Handlebars | `scripts/system/handlebars.js` | Template helpers (`add`, `progress-buttons`, `toJSON`, `join`) and partials |
| Fonts | `scripts/system/fonts.js` | Custom font registration (Ysgarth, Luminari, Labrada, etc.) |
| KeyBindings | `scripts/system/keybindings.js` | `E` (toggle edit), `Alt+T` (wrap tag markup), `T` (toggle sidebar), `F` (fellowship sheet), `R` (dice roller) |
| Renderers | `scripts/system/renderers/` | Document-to-HTML renderers for `@render` enricher |
| Chat | `scripts/system/chat.js` | Track completion detection (`detectTrackCompletion`) and chat message builders |
| Logger | `scripts/logger.js` | Styled `error`, `warn`, `info`, `success` wrappers — use instead of bare `console.*` |
| LitmItem | `scripts/item/litm-item.js` | Custom Item class with legacy tag-to-effect migration |
| SuperCheckbox | `scripts/components/super-checkbox.js` | `<litm-super-checkbox>` — cycles: "" -> positive -> negative -> scratched |
