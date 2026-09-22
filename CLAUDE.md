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

`LitmActorSheet` also owns the roll dialog (`hasRollDialog`, `rollDialogInstance`, `renderRollDialog`, `resetRollDialog`, `updateRollDialog`). They live on the base, not on `HeroSheet`, because Acting Together rides the Fellowship actor — and because the roll-dialog HUD and the roll sockets address whatever actor the `rollDialogOwner` flag names, without checking its type.

### Roll Flow

```
HeroSheet roll → LitmRollDialog (tag selection)
  → calculatePower()
  → new LitmRoll("2d6 + {power}", ...)  -- DoubleSix term maps d12 → 2d6 range
  → ChatMessage rendered, "litm.roll" hook fires (auto-scratch, gain improvements)
  → socket broadcast resets dialogs on all clients
```

The dialog's `#selectionMap` is the source of truth for tag selections, not form fields.

**GM-initiated (Narrator's Call).** The inverse path, Core Book p.269/p.272 — and
it is a **shared table, not a handoff**: one roll object that the Narrator and the
roller look at live.

```
CallForRollApp (GM)  -- picks WHO is rolling, and optionally WHICH Action
  → openSharedRoll()  ("litm.narratorCall" hook, cancellable)
  → actor flag rollDialogOwner  (HUD strip lights up for the rest of the table)
  → "openRollDialog" socket  →  shouldJoinSharedRoll() on every client
  → applySharedRoll() → dialog.configureSharedRoll() on the roller's client
                                                  and on the Narrator's
  → Narrator sets move / Might / their invocations IN that window;
    roller sets their own tags and Trade Power and presses Roll
```

The authority split lives in `modules/apps/roll/roll-authority.js` (pure,
unit-tested):

- **Narrator's half** — move type and Might. Locked for non-GMs whenever the roll
  carries a narrator stamp (`canEditNarratorFields`). Enforced in the template
  (`disabled`), in `#handleTypeChange` / `#handleMightChange`, which revert, and
  in `setType`, which the hero sheet's Sacrifice button calls directly; the
  markup is not the boundary. **The GM may set the move and the Might on any
  roll, called or not** — judging Might is the Narrator's job (p.272), so the
  settings column renders for them even as a non-owner viewer. That is a
  deliberate widening of the pre-branch behaviour, where the column was
  owner-only.
- **Nothing that contributes to Power is read from the form.** `extractRollData`
  takes it all from the dialog's own fields, because `FormDataExtended` skips
  `:disabled` controls — reading Might off the form would drop exactly the value
  the Narrator had just set, and `modifier`/`title` have no form control at all.
- **Roller's half** — their own tags, modifier, Trade Power. Trade Power is
  additionally off for a group roll (`canEditTradePower`).
- Selection entries carrying `narrator: true` stay locked for non-GMs in both
  `makeTagDecorator` and `LitmRollDialog#canModifyTag`.

`resolveSharedRollOwner` picks the seat: an active non-GM owner of the Hero, else
the Narrator, who rolls on the Hero's behalf in the same window.

The picker lays out side by side — roster left, the chosen character's Actions
right — and both columns carry a **fixed** block-size rather than a max, so the
window does not grow downward as a Hero accumulates Actions. Foundry gives you
width and withholds height; spend the width.

`sendRollRequest` is the one entry the action sheet, the actions browser and
the `@action` enricher all call. **An Action embedded on a Hero calls the roll
for that Hero** and never opens the picker — `action.parent` is the
discriminator rather than the surrounding app, because it is also right for the
enricher, which has no surrounding actor. `callForRollLabel` labels the button
to match.

There is **no durable chat record** of a call. Pickup is the existing roll-dialog
HUD strip in `#players`, driven by the same `rollDialogOwner` flag every other
open roll uses; the roll posts its own card. `litm.narratorCallReceived` is gone
with the receive step it named.

**Closing a view is not ending the roll.** A viewer, including the Narrator,
can close their window without retracting the owner's presence. The owner
closing an abandoned call releases its narrator stamp and tag locks. Submission
for moderation instead suspends the same draft, preserving its authority if
rejected. A subsequent independent Sacrifice must not inherit a cancelled
call's authority. Local release happens before awaiting presence persistence.

**Where a Narrator calls from.** The primary control is on the main screen,
directly above the player list (`CallForRollHud`) — the one place already
showing who is at the table becomes the place you call on them, and it costs no
layout Foundry was not already spending, since `#players` is anchored
bottom-left and grows upward into canvas. It shares that region with the HUD
strip, and **order there is CSS, not insertion**: `#players` is a `flexcol`
whose own first child is the collapsed `#players-inactive`, so both litm widgets
carry a negative `order` (`mountPlayersHud` only guarantees presence). The strip
is above the control, so the control never moves when a roll goes live. The
story-tag sidebar keeps a secondary entry in its **window header** via
`_getFrameButtons` — v14 renders those inline before the close button, unlike
header *controls*, which go to the overflow menu. `R` opens the picker for a GM,
with the same toggle behaviour it has for players, and a GM with an assigned
character still gets the picker rather than their own sheet.

Pickup is only shown when the dialog is not already rendered on this client;
the rendered/closed hooks refresh the HUD independently of actor flag updates.
The Narrator tour uses a separate `localOnly` roll-dialog preview, with its own
application ID: it never advertises presence, synchronizes, or executes a roll,
and tour cleanup must not close an actor's live shared dialog.

Invocations the roller can't see — a concealed Challenge's tags, say — still count
toward Power, so the dialog renders them as **masked rows** ("Something unseen",
tier intact, no name, no actor). Concealment is the Narrator's tool; silent
arithmetic is not. See `LitmRollDialog#buildConcealedRows`.

**The chat card masks them too.** `LitmRoll#getTooltipData` runs every tag list
through `maskConcealedTags` (`concealment.js`, pure and unit-tested), so the
tooltip a player opens shows the same "Something unseen" with the same tier. The
tooltip is rendered per client, so the Narrator still reads the real names.
Without it the dialog's mask lasted exactly as long as it took someone to hover.
`StoryTagsStore.hiddenActorIds` holds policy independently of sidebar membership;
`concealedActorIds` applies the viewer's GM bypass for the dialog and target
picker. Removing an actor from the sidebar is not a reveal. Live sources follow
an explicit reveal; roll tags record `tagActorId` and `concealedAtRoll` so a
deleted source cannot accidentally reveal a historical secret. Missing legacy
actor-backed sources fail closed.

Moderation uses the same projection. Stored public card HTML is masked even
when authored by a GM; `renderModerationTooltip` replaces it per viewer, using
the unredacted execution data in message flags. Presentation masks must never
replace the raw tags needed for approval, scratch, or improvement bookkeeping.

**Acting Together (group roll).** Core Book p.157: one roll for the whole group.
The same shared dialog, keyed to the **Fellowship actor** — that is what rolls, so
the GM owns it and presses Roll. Where there is no Fellowship (`use_fellowship`
off) Acting Together is simply not offered; there is no fallback.

```
CallForRollApp → the Fellowship row of the roster → openSharedRoll({
    actorId: fellowship.id, participantIds: resolveFellowshipParticipants(...) })
  → dialog.isGroupRoll (actorId === fellowship.id)
  → buildGroupRollTabs(): one tab per participant + Fellowship + Story
  → each participant's client opens it and contributes from their own tab
```

The rules live in `modules/apps/roll/group-roll.js` (pure, unit-tested):

- **One tag per Hero.** `findHeroTagConflict` keys off `tagActorId`, stamped on
  every selection by `resolveTagActorId` (effect → parent → Actor). Resolved from
  the effect and *not* from who clicked: the GM owns the dialog, and contributor
  metadata is only registered by non-owners. Relationship tags count against the
  Hero's one for free — they live on the Hero. Fellowship theme tags and the
  opposition's are exempt for free — they don't resolve to a participant.
- **One burn for the whole group** needs no new code: `findBurnedSelection` in
  `burn-cap.js` already caps the entire selection map at one scratched tag.
- **Participants are the whole group** — every Hero linked to the Fellowship
  (`resolveFellowshipParticipants`, which normalises through
  `resolveGroupParticipants` so hero order and de-duplication have one
  definition). "Linked" mirrors `HeroData#fellowshipActor`: this Fellowship's
  id, or none at all, which falls back to the singleton. There is no subset to
  tick — Helping Each Other is the mechanic for "some of us pitch in", and it
  is already implemented as contributed tags. An offline participant stays in
  the roll and contributes nothing. Changing participants re-runs
  `configureSharedRoll`, which resets the dialog.
- A participant may touch their own Hero's tags **and the Fellowship's**, and
  nothing else. `actableActorIds` (`roll-dialog-context.js`) is the one
  definition, gating three surfaces that must agree: whether a tab renders in
  full (`buildGroupRollTabs`), whether a row is locked (`makeTagDecorator`),
  and whether a change is accepted (`#canModifyTag`). The Fellowship is in that
  set by rule, not by ownership — p.157, "any or all of the Fellowship theme
  power tags may be invoked". Being exempt from the per-Hero cap and being
  reachable are separate questions; conflating them once hid the Fellowship tab
  from every player, since an unselected tab renders as nothing at all. A client
  owning no participating Hero is not in the roll and gets neither.

Post-roll bookkeeping lands per tag, not per rolling actor: `scratchTag` resolves
through the uuid, and `gainImprovement` traces effect → theme → owner, so a burn
or an invoked weakness marks the contributing Hero. The card records
`participantIds`, and the GM's apply flow pre-selects them as targets. Applying
consequences to each of them is still a decision, not an automatic fan-out.

**Two world settings, deliberately separate — do not collapse them.**

- `player_initiated_rolls` — **default on**, and it gates **players only**. GM
  initiation and player initiation are not two halves of one toggle: calling for
  a roll is an unconditional Narrator capability (p.269), and this setting
  decides whether players may *also* reach for the dice unprompted. A table that
  wants every roll to come from the Narrator turns it off. Every GM entry point —
  the main-screen control, the sidebar's window-header entry, `R` — is therefore
  gated on `isGM` alone and never on this setting, even though `canInitiateRoll`
  would answer the same today; a test pins that. It gates *instigation* only.
  Joining an open roll, being called into one, reacting, camp actions and
  Sacrifice stay open regardless.

  Instigation splits two ways, and the split is deliberate. The **hero-sheet
  Roll button and `R`** — the same gesture, one with a mouse — stay available
  and *ask* for a roll: `requestRollFromNarrator` (`roll-request.js`) whispers
  the Narrators a card whose one button calls the roll through `openSharedRoll`.
  Hiding the button instead left the player mute, and it was the only control in
  that row that vanished. **Sheet tag click and rolling an Action** still take
  `blockPlayerInitiatedRoll`'s toast: they name a specific tag or Action, and a
  request card that silently dropped it would answer a question nobody asked.

  A call needs no chat record because the shared dialog is its own notice; an
  ask opens nothing and must survive a Narrator who is mid-sentence, which is
  why this direction gets a durable card. A live `rollDialogOwner` flag on that
  Hero suppresses a second one. The stored key is deliberately unchanged: `ClientSettings#get`
  builds a Setting from the registered default when nothing is stored and only
  `set()` writes, so the default reaches every world that never touched the
  toggle while preserving the choice of any table that did.
- `require_roll_approval` gates *execution*: a player pressing Roll posts the
  existing moderation card instead of rolling, and the GM's approval executes it
  on the player's own client, so the resulting chat card is authored by the
  player. Same hardened path as the opt-in "Send to Narrator" button —
  `resolveApprovedRoll` reads the roll back off the ChatMessage the roller
  authored rather than trusting the socket payload. Group rolls skip it: the GM
  already owns that dialog. Predicate: `requiresRollApproval` in
  `roll-authority.js`.

A table can want either without the other, which is why they are two booleans
and not one three-state setting.

### Sockets

Namespace `system.litmv2`. Events cover roll-dialog open/sync/close, GM moderation, GM-proxied mutation of unowned documents (scratch, apply success/status, hero creation), story tags, and camping. Canonical list and payload shapes: `modules/system/sockets.js` — read it rather than guessing an event name.

`openRollDialog` starts a shared roll: the payload names the actor, the resolved
`ownerId`, the participants (Acting Together only) and the Narrator's stamp.
`shouldJoinSharedRoll` decides who opens it — the owner, plus any player owning a
participating Hero. Everyone else sees the HUD strip.

`updateRollDialog` is owner-authoritative (`roll-sync.js`). Contributors send
only the fields/tag IDs they changed; the owner merges them, rechecks the group
tag and burn caps, and broadcasts a versioned canonical snapshot. Pending local
edits replay until their sequence is acknowledged, so crossing Narrator/player
updates and simultaneous group contributions do not erase each other. Session
IDs keep delayed snapshots and close/reset events from mutating a newer roll.
The canonical state includes the narrator stamp, participants, title and Action,
so a late HUD join reconstructs the same draft.

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

### Choosing a character

There is one character-selection control and new surfaces use it rather than
inventing a row: `modules/apps/roster.js` builds the entry,
`templates/partials/roster-row.html` renders it, `.litm--roster*` styles it
(`litmv2.css` §21). A row is portrait, name, and one line of context under the
name — a cast list, not a row of tiles.

- **The input is the only event path.** Each row is a `<label>` wrapping a real
  radio (or a checkbox, for surfaces that tick several). A `change` listener
  fires for both a mouse click and a keyboard Space or arrow key; a
  `data-action` click handler would fire for the mouse and stay silent for the
  keyboard. It is also the whole form contract for the DialogV2 pickers, which
  read `input[name=…]:checked`.
- **Presence is opt-in** (`presence: true`). The "who is playing them" line and
  the dimmed portrait belong to player-ownable characters. Challenges and
  Limits go through the same control without them — a Challenge reading
  "no player assigned" would read as a broken Hero. There is deliberately no
  presence *dot*: the rows already contain a visually hidden radio, and a
  second small circle on the right read as an unchecked one.
- **Names are masked** (`system.maskedName ?? name`) and **portraits always
  resolve** (prototype token → actor image → `CONFIG.litmv2.assets.icons.defaultActor`).
  Both were inconsistent across the surfaces this replaced, and the masked name
  is load-bearing: the target picker lists concealed Challenges.

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
- `litm.narratorCall` — `(payload, actor)` before the Narrator opens a shared roll; return `false` to cancel, or mutate `payload` to rewrite it. (There is no `litm.narratorCallReceived` any more: with one shared roll object there is no separate receive step to hook.)

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
