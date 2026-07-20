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

- **`game.litmv2`** (`litmv2.js`) — replaceable classes (`LitmRoll`, `LitmRollDialog`, `WelcomeOverlay`, `StoryTagApp`, `SpendPowerApp`, `ApplyActionMenuApp`, `ThemeAdvancementApp`), `data.*` models, `methods.calculatePower`, `fellowship` singleton getter, `ContentSources`
- **`CONFIG.litmv2`** (`modules/system/config.js`) — `roll.{formula,resolver}`, `heroLimit`, theme tiers, asset paths, `THEME_TAG_TYPES`/`POWER_TAG_TYPES`, tag-string regex
- **Custom hooks** `litm.*` — see "Custom System Hooks" below

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

```
modules/
  actor/           # hero, journey, challenge, fellowship, story_theme data + sheets
    mixins/        # EffectTagsMixin, LimitsMixin, actor-limits helpers
  item/            # theme, story_theme, backpack, themebook, vignette, trope, addon
  active-effects/  # tag/status type data models + ScratchableMixin
  apps/            # standalone apps (roll/, welcome/, story-tags/, spend-power, theme-advancement, etc.)
  sheets/          # base sheet classes + mixins + landscape variants
  system/          # config, settings, sockets, migrations, hooks/, renderers/
  components/      # SuperCheckbox custom element
  hud/             # custom token HUD
  utils.js, logger.js
templates/         # Handlebars templates (actor/, item/, chat/, apps/, effect/, hud/, partials/)
lang/              # en, de, es, cn, fr, no
packs/             # compendium (status-effects)
```

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

`HandlebarsApplicationMixin(ActorSheetV2)` → `LitmSheetMixin` → `LitmActorSheet` → typed sheets (Hero/Challenge/Journey/Fellowship/StoryThemeActor; Challenge & Journey also mix in `TagStringSyncMixin`). Each typed sheet has a `Landscape` variant. Item sheets follow the same chain via `ItemSheetV2` → `LitmItemSheet`.

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

Namespace `system.litmv2`. Events: roll dialog sync (`updateRollDialog`, `requestRollDialogSync`, `resetRollDialog`, `closeRollDialog`), GM moderation (`rollDice`, `rejectRoll`), GM-applied ally-tag scratch (`scratchEffect`), GM-proxied success application to unowned targets (`applySuccessAsGM`), GM-proxied Spend Power status add/reduce on unowned targets (`applyStatusAsGM`), story tags (`storyTagsUpdate`, `storyTagsRender`), camping (`campingOpen`, `campingSaveOp`, `campingEnd`), GM-proxied hero creation for players without `ACTOR_CREATE` (`createHeroAsGM`). Definitions in `modules/system/sockets.js`.

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

**Effect factories** in `effect-factories.js` (`powerTagEffect`, `weaknessTagEffect`, `fellowshipTagEffect`, `relationshipTagEffect`, `storyTagEffect`, `statusTagEffect`) produce properly-shaped creation data. `parseTagStringMatch()` in `modules/item/action/tag-string.js` converts a `CONFIG.litmv2.tagStringRe` match into AE creation data.

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

The system has a fully-implemented visual identity — **not aspirational**. New UI must match. When you find yourself writing inline `style="..."` or `border-radius: 999px`, stop — there's likely a litm token or class for it.

**Use Foundry tokens where they exist** (spacing `--spacer-2/4/8/12/16`, text colors `--color-text-*`, font sizes `--font-size-*`). litm tokens fill the rest (game colors, fonts, custom radii).

### Design context

**Users.** Tabletop RPG players and GMs running the Mist Engine inside Foundry. Mix of seasoned Foundry users and tabletop players new to digital tooling. They are storytellers first, system operators second — the UI's job is to stay out of the fiction while keeping mechanics legible.

**Personality.** *Rustic, ceremonial, literary.* Reads like an illuminated manuscript — warm parchment, hand-lettered titles, gold flourishes — not a spreadsheet. Voice is in-fiction where possible (statuses, tags, blockquoted theme flavor), chrome (form labels, hints) is plain.

**Aesthetic direction.** Two distinct surfaces, both first-class — not one metaphor with a night-mode skin.
- **Light mode** is the parchment surface: cream paper texture, ink-on-paper feel, gold tag chrome with a slight skew, italic serif flavor. This is where the "illuminated manuscript" voice lives.
- **Dark mode** is *not* parchment-at-night. The substrate is deep navy/charcoal; the gold/sage/rose tag accents and serif italic carry over, but the parchment texture, paper warmth, and ink-stained feel are gone. Treat it as its own surface — a dim, atmospheric UI that shares typography and accents with the light mode but not its material.

**Anti-references.** Flat Material/admin-tool greys (`--color-header-background`), pill spans, neon-on-black gamer UI, generic Foundry default rendering. And: do not describe or design dark mode as "parchment by candlelight" — it isn't one.

### What the system looks like

- **Light mode** sheets and chat sit on a **parchment texture** wired into `--background`, `--sidebar-background`, `--chat-message-background`. Card surfaces should let it show through; don't paint with `--color-header-background` (flat-grey "admin tool" look). **Dark mode** swaps the substrate for a deep navy/charcoal — there is no parchment in dark mode; don't try to fake one. Both modes share the gold/sage/rose tag chrome and serif italic; the *material* changes between modes, the *accents* don't.
- **Tag chrome**: serif italic with `text-stroke` outline in the tag color + skewed background bar (`transform: skewX(-3deg)`). Reuse the `.litm-tag`/`.litm-power_tag`/etc. classes via the `:where(...)` rule in `litmv2.css` section 4 — don't reinvent with plain inputs or pill spans.
- **Status tier pips** render inline beside the status name (`○●●●○○`), color-coded by polarity (sage green = helpful, rose = hindering). Filled count = current tier.
- **Section headers** extend horizontal lines (`::before`/`::after` `flex: 1 border-top`) in small-caps, letter-spaced. See `.litm-render__section-header`. Used inside cards, in the roll dialog group fieldsets, and as column headers in the story-tag sidebar.
- **Blackletter Ysgarth** is reserved for ceremonial slots: actor sheet titles (proper names like *Gerrin Deerstalker*, *Fellowship*), trope category headers in the welcome overlay (*VILLAGE FOLK*, *MONSTERS & GODS*), and in-fiction banners. Never on form labels, buttons, or repeated UI chrome.
- **Decorative bullet** ` ✦ ` (U+2726) separates tags in play-mode display.
- **Italic blockquote flavor text** inside theme/vignette cards between header and body.
- **Tracks** use `○ ○ ○` empty-circle progress with custom checkbox SVGs for filled state.
- **Welcome overlay** is intentionally self-contained: forest-mountain backdrop, gold blackletter, fixed dark composition. It does not adapt to light/dark theme — it's an immersion piece, the entry rite to a hero. Don't refactor it to track `theme-light`.

### Design tokens

```
Spacing       (Foundry) --spacer-2/4/8/12/16   (0.125 / 0.25 / 0.5 / 0.75 / 1 rem)
Radius        --border-radius (4px), --radius-sm/md/lg/xl (3/6/8/10 px),
              --radius-pill (100px), --radius-circle (50%)
Shadows       --shadow-sm/md, --shadow-glow/glow-strong
Transitions   --transition-fast/normal/slow/slower (0.12/0.15/0.2/0.25 s)
Game colors   --color-litm-tag (gold), --color-litm-status (sage),
              --color-litm-limit (rose), --color-litm-weakness (apricot),
              --color-litm-banner (beige), --color-litm-track-*, --color-litm-might-*
Alpha tints   --color-warm-1-10/25/50, --color-text-primary-10/15/40, --color-overlay-white-3/5/7/8/10
Fonts         --font-blackletter (Ysgarth — ceremonial: actor titles, welcome overlay
                                   trope categories, in-fiction banners only),
              --font-h2 (Grenze, section/card titles),
              --font-h4 (PowellAntique, overlays),
              --font-serif (Labrada → Fraunces, body),
              --font-blockquote (Labrada italic, flavor text)
```

**No local spacing tokens.** Snap to Foundry `--spacer-*` at or below 1rem. Above 1rem (1.25/1.5/2rem card padding) — keep as raw rem; those are literal surface-scale layout values, not redefined tokens.

### Established UI patterns — reuse, don't reinvent

| Pattern | Class | Use For |
|---------|-------|---------|
| **Tag chrome** | `.litm-tag` / `.litm-power_tag` / etc. (`:where(...)` in CSS §4) | Any in-game tag display |
| **Section header with extending lines** | `.litm-render__section-header` | Section dividers in cards/sheets/dialogs |
| **Manuscript title** (centered Ysgarth) | `.litm-render__title` | Embed cards, large titles |
| **Embed card base** | `.litm-render--card` | Card-shaped containers |
| **Banner plaque** | `.litm-banner` | Small status/category labels with weight |
| **Ingress paragraph** | `.litm--ingress` | Lead paragraph in long descriptions |

### App composition patterns

How the established primitives compose into the system's signature surfaces. When building a new app/dialog/card, reach for the closest existing composition first.

- **Theme card** (in hero/fellowship sheets): `[avatar] [title row with ✦ bullet] → italic blockquote flavor → gold tag pills row → progress tracks row`. The `✦` separates the theme's name from its tagline; tracks (Quest/Improve/Milestone) sit at the bottom as `○ ○ ○` rows. See hero sheet `.litm-theme-card` family.
- **Roll dialog grouping**: tag selections grouped into sections — Status, Story, then one section per theme (Hardened Warrior, Devoted to Family, …) — each section gets a `.litm-render__section-header` (extending lines, small-caps). Tags within use the standard chrome with super-checkbox cycling. Pattern is canonical for any tag-picker UI.
- **Story-tag sidebar** (`StoryTagSidebar`, popout via `T`): horizontal grid of actor columns — Fellowship, Story Tags, each Hero, each Challenge. Each column has a header (small avatar + actor name in small-caps), then its tag list with inline `+ Add` input, and status tier pips. A shared "Add Actor" CTA at the bottom. This is the manage-everything-at-once surface; mirror its column structure when building scene-wide management UI.
- **Chat outcome card**: colored outcome badge top-left (`success` = sage, `success_and_consequences` = amber, `consequences` = rose) + outcome label + total power top-right. Body lists the contributing tags inline. Standout primary CTA (e.g. "Push your luck") sits at the bottom of the card in warm amber. Mirror this for any post-action result card.
- **Spend Power menu** (and other action menus): each option is a row of `[icon] [title + one-line description] [cost pill]`. Big primary "Spend" button at the bottom. Use for any "pick one of N costly actions" dialog.

### Design principles

1. **Atmosphere through restraint** — the parchment + gold tags + serif italic carry it. Don't pile on.
2. **Newcomer-friendly** — discoverable, tooltipped, consistent.
3. **Reuse before reinvention** — if a new feature doesn't look like the rest, the new feature is wrong.
4. **Both themes matter** — test light & dark; most game tokens are theme-aware via `body.theme-light`/`body.theme-dark`.
5. **Two failed fixes = wrong layer.** If a visual fix hasn't landed after two attempts,
   stop patching the symptom: find the canonical template/partial/class that owns the
   element (tables above) and re-derive from it. Stacked overrides — filters,
   `!important`, magic offsets — are the signal you're fighting a hand-rolled element
   that should be using the design system.
