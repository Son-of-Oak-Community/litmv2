# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## About

Legend in the Mist is a Foundry Virtual Tabletop (v14 minimum) system for a rustic fantasy RPG based on the Mist Engine. The system id is `litmv2`.

## Commands

- `node check-keys.js` — find missing localization keys across language files
- `node diff.js` — diff localization keys between language files
- `node scripts/system/build-packs.js` — generate status card source files in `packs/status-effects/_source/`, then compile with `fvtt package pack status-effects`
- E2E tests: `cd tests/e2e && npx playwright test`

## Architecture

### Entry Point (`litmv2.js`)

`SuperCheckbox` registers before any hooks fire. The `init` hook then runs in this order:

1. Exposes `game.litmv2` with references to apps (`LitmRollDialog`, `LitmRoll`, `WelcomeOverlay`, `StoryTagApp`, `SpendPowerApp`, `ThemeAdvancementApp`), data constructors (`TagData`, `StatusCardData`, `StoryTagData`, `ThemeTagData`), a `fellowship` getter, and `methods.calculatePower`
2. Sets `CONFIG.Actor.dataModels`, `CONFIG.Actor.trackableAttributes.hero`, `CONFIG.Item.documentClass` (`LitmItem`), `CONFIG.Item.dataModels`, `CONFIG.ActiveEffect.dataModels`
3. Calls `LitmSettings.register()` (must happen before dice — custom dice are gated on a setting)
4. Conditionally registers `CONFIG.Dice.terms["6"] = DoubleSix` when `LitmSettings.customDice` is enabled; always pushes `LitmRoll` to `CONFIG.Dice.rolls`
5. Sets `CONFIG.litmv2 = new LitmConfig()`
6. Replaces the combat tracker sidebar with `StoryTagSidebar` (`CONFIG.ui.combat`)
7. Unregisters core Foundry sheets and registers all system sheets (4 actor + 4 landscape + 7 item)
8. Calls `HandlebarsHelpers.register()`, `HandlebarsPartials.register()`, `Fonts.register()`, `KeyBindings.register()`, `LitmHooks.register()`

Separate hooks handle deferred registration:
- **`i18nInit`**: `Enrichers.register()` (needs localized strings)
- **`ready`**: `migrateWorld()`, `Sockets.registerListeners()`, aliases `game.litmv2.storyTags = ui.combat`

`CONFIG.litmv2` is a `LitmConfig` instance (`scripts/system/config.js`) holding asset paths, roll config (`formula`/`resolver` overrides), challenge/vignette type lists, theme level tiers, and tag/scene-link regex patterns.

### ApplicationV2 Pattern

All apps and sheets use Foundry's **ApplicationV2 API** (not the deprecated AppV1):

- Actor sheets extend `LitmActorSheet` (`scripts/sheets/base-actor-sheet.js`), which extends `LitmSheetMixin(HandlebarsApplicationMixin(ActorSheetV2))`
- Item sheets extend `LitmItemSheet` (`scripts/sheets/base-item-sheet.js`), which extends `LitmSheetMixin(HandlebarsApplicationMixin(ItemSheetV2))`
- Standalone apps extend `HandlebarsApplicationMixin(ApplicationV2)` directly
- Each actor type also has a **landscape sheet variant** (e.g., `HeroSheetLandscape`) registered as a non-default alternative, defined in `scripts/sheets/landscape-sheets.js`

`LitmActorSheet` adds a `MODES` enum (`PLAY = 0`, `EDIT = 1`) and a `_mode` property. Sheets toggle between play and edit templates by overriding `_getEditModeTemplate()` and `_configureRenderParts()`.

`LitmActorSheet._updateEmbeddedFromForm(submitData)` parses `items.*` and `effects.*` keys from form data and performs embedded document updates. Used by hero and challenge sheet submit handlers.

Action handlers are **private static methods** on sheet classes (e.g., `HeroSheet.#onOpenRollDialog`), referenced by string key in `DEFAULT_OPTIONS.actions`. Despite being declared `static`, ApplicationV2 binds `this` to the **sheet instance** when calling them — so `this.document`, `this.actor`, etc. all work as expected inside these methods.

### Data Models

All data models extend `foundry.abstract.TypeDataModel` and define schemas using `foundry.data.fields`. The shared `TagData` embedded model (used in themes) is accessed via `game.litmv2.data.TagData` after init.

Actor types: `hero`, `journey`, `challenge`, `fellowship`
Item types: `theme`, `themebook`, `trope`, `backpack`, `story_theme`, `vignette`, `addon`
ActiveEffect types: `story_tag`, `status_card`, `theme_tag`

### Template Paths

All Handlebars template paths are prefixed with `systems/litmv2/`:

```javascript
// Correct
template: "systems/litmv2/templates/actor/hero.html"
// In HTML partials
{{> "systems/litmv2/templates/partials/play-tag.html"}}
```

### Sockets & Multiplayer

`Sockets.dispatch(event, data)` in `scripts/system/sockets.js` emits on `"system.litmv2"`. `Sockets.on(event, cb)` registers per-event handlers (one handler per event, ignores messages from the sender). Listeners are registered via `Sockets.registerListeners()` in the `ready` hook.

### Roll System

`LitmRollDialog` (ApplicationV2) collects tag selections and power. It calls `LitmRoll` (extends `foundry.dice.Roll`), which uses the custom `DoubleSix` dice term (denomination `"6"`, internally a d12 mapped to 2d6 range via `Math.ceil(total / 2)`). Roll formula and resolver can be overridden on `CONFIG.litmv2.roll`.

Roll dialog presence is tracked via actor flags (`actor.getFlag("litmv2", "rollDialogOwner")`) and displayed in the HUD overlay (`#litm-roll-dialog-hud`).

## Key Conventions

### Localization

All user-facing strings must use localization keys from `lang/en.json`. Use the `localize` utility (aliased as `t`) from `scripts/utils.js` — see Utility Functions above. When adding new keys, add them to all language files (use `node diff.js` or `node check-keys.js` to find gaps).

### CSS Class Naming

System-specific classes use `litm--` prefix (BEM-inspired):

```html
<div class="litm litm--roll">
	<span class="litm--tag" draggable="true">tag name</span>
	<span class="litm--status">status-1</span>
</div>
```

Use Foundry's built-in utility classes for layout (`.flexrow`, `.flexcol`, `.flex1`, `.scrollable`, `.hidden`). Prefer Foundry CSS variables (`--color-text-primary`, `--border-radius`) over hardcoded values for theme compatibility. See `CSS_GUIDE.md` for the full reference of available variables and utility classes.

**CSS anti-patterns — do not use:**
- **`border-left` as a selection/active indicator.** Use background color changes instead (e.g., `background: var(--color-warm-1-10)`). Foundry uses background shifts, text emphasis, or full-border changes for active states.
- **`dashed` or `dotted` border styles.** Use `solid` borders (with reduced-opacity color variables if subtlety is needed), or `groove`/`ridge` for decorative separators.

### Custom Elements

`SuperCheckbox` (`litm-super-checkbox`) cycles through states: `""` → `"positive"` → `"negative"` → `"scratched"`. The `states` attribute can override this list.

`SuperCheckbox` is registered before the `init` hook fires.

### Prefer Native Foundry Behaviour

**Always use Foundry's built-in APIs and UI patterns instead of hand-rolling custom solutions.** When Foundry provides a native mechanism, use it — even if a custom approach seems simpler at first. This applies to tabs, dialogs, forms, drag-and-drop, context menus, notifications, and any other UI or framework feature. A symlink to the current Foundry source is at `./foundry/` (client code under `public/`, CSS at `public/css/foundry2.css`). API docs: https://foundryvtt.com/api/v14/

Specific examples:

- **Dialogs:** Use `foundry.applications.api.DialogV2` (not legacy `Dialog`).
- **Template rendering:** Use `foundry.applications.handlebars.renderTemplate()` (not bare `renderTemplate` global).
- **Tabs:** Use Foundry's native ApplicationV2 tab system via `tabGroups`, `changeTab()`, and `data-action="tab"` attributes — never hand-roll tab switching JS. See the pattern below.
- **CSS:** Use Foundry's built-in utility classes (`.tabs`, `.tab`, `.item`, `.flexrow`, `.flexcol`, `.scrollable`, etc.) and CSS variables before writing custom styles.

#### Native Tabs Pattern (ApplicationV2)

For **static tabs** known at class definition time, use `static TABS`:

```javascript
static TABS = {
  group: {
    tabs: [{id: "tab1", icon: "fa-solid fa-book"}, {id: "tab2"}],
    initial: "tab1",
    labelPrefix: "LITM.Tabs"
  }
};
```

For **dynamic tabs** (e.g., generated from data at render time), manually manage `tabGroups` and set `cssClass` on each tab entry in `_prepareContext`:

```javascript
this.tabGroups["my-group"] ??= dynamicTabs[0]?.id;
for (const tab of dynamicTabs) {
  tab.cssClass = this.tabGroups["my-group"] === tab.id ? "active" : "";
}
```

Template markup — nav buttons use `data-action="tab"`, content sections use `class="tab"`:

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

**Gotcha:** `<button>` inside a `<form>` defaults to `type="submit"`. Always use `type="button"` for non-submit buttons in ApplicationV2 apps with `tag: "form"`.

### HeroData Getters (`scripts/actor/hero/hero-data.js`)

`HeroData` provides computed getters for accessing tags and effects. **Always use these instead of manually traversing items/effects** — they handle fellowship inclusion, effect caching, hidden-tag filtering, and consistent data shapes.

- `fellowshipActor` — linked fellowship actor (falls back to singleton)
- `allTags` — all tags from backpack + all active themes (including fellowship themes)
- `powerTags` / `weaknessTags` — theme tags split by type
- `backpack` — story tags on the hero's backpack item
- `effectTags` — all applicable `story_tag` and `status_card` effects (includes transferred effects from items)
- `statuses` — status cards formatted for UI (filters hidden for non-GMs)
- `storyTags` — story tags formatted for UI (filters hidden for non-GMs)
- `relationshipTags` — relationship tags formatted for the roll dialog

### Custom System Hooks

The system emits hooks that modules and macros can listen to:

- `litm.preRoll` — before a roll is submitted. Return `false` to cancel. Receives `{ actorId, tags, title, type, ... }`.
- `litm.roll` — after a roll completes. Receives `(roll, chatMessage)`.
- `litm.rollDialogRendered` — when roll dialog opens. Receives `(actor, dialog)`.
- `litm.rollDialogClosed` — when roll dialog closes. Receives `(actor)`.
- `litm.preTagScratched` — before a tag is scratched. Return `false` to cancel. Receives `(actor, tag)`.
- `litm.tagScratched` — after a tag is scratched. Receives `(actor, tag)`.
- `litm.themeAdvanced` — after a theme is advanced. Receives `(actor, theme, updateData)`.

### Hooks Organization

Hooks are registered via `LitmHooks.register()` in `scripts/system/hooks/index.js`, which delegates to domain-specific modules: `actor-hooks.js`, `chat-hooks.js`, `compat-hooks.js`, `fellowship-hooks.js`, `item-hooks.js`, `preloads.js`, `ready-hooks.js`, `ui-hooks.js`. Add new hooks to the appropriate domain file.

### Data Migrations

**Prefer `static migrateData(source)` in DataModel subclasses** for data shape changes (renaming fields, coercing types, backfilling defaults). Foundry calls `migrateData` automatically whenever a document is loaded, so these migrations are transparent, idempotent, and require no version tracking. Examples exist in `ChallengeData`, `ThemeData`, and `StoryThemeData`. Always call `return super.migrateData(source)` at the end.

`scripts/system/migrations.js` provides a separate sequential world-migration system for bulk operations that cannot be handled by `migrateData` alone (e.g., renaming document types, moving data between documents). `migrateWorld()` runs on the `ready` hook (GM-only) and executes pending entries from the `MIGRATIONS` array. Use this only when DataModel-level migration is insufficient.

### Settings (`scripts/system/settings.js`)

`LitmSettings.register()` registers world and client settings with static getter/setter accessors:
- `welcomed` (world) — whether the welcome overlay has been shown
- `storytags` (world) — shared story tags data
- `systemMigrationVersion` (world) — tracks applied migration version
- `fellowshipId` (world) — ID of the fellowship actor
- `customDice` (client) — toggle custom dice rendering
- `popoutTagsSidebar` (client) — tags sidebar popout preference

### Asset Preloads

New `.webp` assets must be added to the `preloads` array in `LitmConfig` (`scripts/system/config.js`). Preload logic lives in `scripts/system/hooks/preloads.js`. All images use `.webp` format. Icons use `.svg`.

### Logging (`scripts/logger.js`)

**Always use the system logger instead of bare `console.log/warn/error`.** The logger prefixes messages with a styled "Legend in the Mist |" label for easy filtering.

```javascript
import { error, warn, info, success } from "../logger.js";
error("Something failed");    // console.error with styled prefix
warn("Heads up");             // console.warn with styled prefix
info("FYI");                  // console.log with styled prefix (blue)
success("Done");              // console.log with styled prefix (green)
```

**Exception:** `.catch(console.error)` callbacks are acceptable since the logger's `args.join("\n")` loses Error stack traces. For catch blocks with context strings, use the logger: `catch (err) { error("Migration failed", err); }`.

### Utility Functions (`scripts/utils.js`)

- `localize(...key)` — wrapper around `game.i18n.localize()`. Import as `t`: `import { localize as t } from "../utils.js"`
- `queryItemsFromPacks({ type, filter, indexFields, map })` — queries world items and compendium pack indices by type, with optional filtering and mapping. Use this instead of manually iterating packs.
- `findThemebookByName(name)` — searches world items then compendium packs for a themebook by name.
- `enrichHTML(text, document)` — wraps `TextEditor.enrichHTML()` with owner-aware secrets and `relativeTo` context.
- `confirmDelete(string)` — shows a `DialogV2.confirm()` prompt; returns `false` on cancel or X-button close.
- `toQuestionOptions(questions, skipFirst)` — maps question arrays to letter-indexed option objects (A, B, C…).
- `titleCase(str)` — converts to title case, skipping articles (and, the, of, etc.).
- `sleep(ms)` — Promise-based delay.
- `effectToTag(effect, typeOverride)` — maps an ActiveEffect to a TagData-compatible plain object (synthesizes `isActive` from `!effect.disabled`).
- `themeTagEffect({name, tagType, question, isScratched, isSingleUse})` — builds `theme_tag` ActiveEffect creation data.
- `storyTagEffect({name, isScratched, isSingleUse, isHidden, limitId})` — builds `story_tag` ActiveEffect creation data. Add `transfer: true` at the call site for item-level tags.
- `statusCardEffect({name, tier, isHidden, limitId})` — builds `status_card` ActiveEffect creation data.
- `updateEffectsByParent(actor, updates)` — routes batched effect updates to the correct parent document (actor or embedded item).

### Testing

E2E tests use Playwright in `tests/e2e/`. Specs are in `tests/e2e/specs/`, selectors in `tests/e2e/helpers/selectors.ts`.

### Hot Reload

The system supports hot reloading for `css`, `html`, `js`, and `json` files in `templates/`, `lang/`, `litmv2.css`, and `litmv2.js`. No build step is required; edit files directly.

## Design Context

### Users
Primary audience is TTRPG players and GMs running Legend in the Mist sessions online via Foundry VTT. The system should also feel welcoming to newcomers who are new to virtual tabletops — clear affordances, discoverable UI, no assumed Foundry knowledge.

### Brand Personality
**Rustic, warm, storied.** The interface should feel like a well-loved book of legends — aged but inviting, with the warmth of candlelight and parchment. Typography leans on blackletter headings (Ysgarth), decorative serifs (Luminari, PowellAntique), and readable body serifs (Labrada, Fraunces). The color palette is earth-toned: golden mustard tags, sage green statuses, muted rose limits, warm beige banners.

### Emotional Goals
- **Immersion & wonder**: The UI should transport players into the world, not remind them they're using software. Decorative elements (banners, tag badges, antique fonts) serve atmosphere.
- **Confidence & clarity**: Despite the decorative layer, information hierarchy must be crystal clear. Players should always know where they are, what they can do, and what just happened.

### Aesthetic Direction
- Warm earth tones with strong light/dark mode support
- Antique/rustic typography with clear readability hierarchy
- Notched banners, stroke-effect tag badges, parchment textures
- Foundry utility classes and CSS variables as the foundation layer
- **Anti-reference**: Avoid overly ornate or heavy decoration that slows comprehension. Decoration should serve atmosphere, never obstruct usability.

### Design Principles
1. **Atmosphere through restraint** — Decorative elements (fonts, banners, textures) create mood, but never at the cost of clarity. When in doubt, simplify.
2. **Newcomer-friendly** — Every interaction should be discoverable without a manual. Tooltips, clear labels, and consistent patterns over clever shortcuts.
3. **Foundry-native first** — Use Foundry's built-in UI patterns, utility classes, and CSS variables before writing custom solutions. This ensures theme compatibility and reduces maintenance.
4. **Warm, not heavy** — The palette and typography evoke aged parchment and candlelight, but the interface should feel light and responsive, not weighed down by decoration.
5. **Both modes matter** — Light and dark themes are first-class citizens. Every color, texture, and decorative element must work well in both.
