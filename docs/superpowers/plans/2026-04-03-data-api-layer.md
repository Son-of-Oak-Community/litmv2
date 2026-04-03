# Data API Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all plain-object tag mapping with direct ActiveEffect document access across the entire system — item getters, actor getters, roll dialog, sidebar, and templates.

**Architecture:** Item data models return `ActiveEffect[]` directly from their tag getters. HeroData provides structured getters (`themes`, `backpack`, `fellowship`, `relationships`, `statuses`) that return AEs grouped by UI section. The roll dialog uses a `Map<effectId, {state, contributorId, sourceUuid}>` for transient selection state. Templates access AE properties via `effect.system.*` and parent context via `effect.parent.*`.

**Tech Stack:** FoundryVTT v14, ES modules, Handlebars templates

**Spec:** `docs/superpowers/specs/2026-04-03-data-api-layer-design.md`

---

## File Map

### Files to Modify
- `scripts/data/active-effects/power-tag-data.js` — remove `isStatus`
- `scripts/data/active-effects/weakness-tag-data.js` — remove `isStatus`
- `scripts/data/active-effects/fellowship-tag-data.js` — remove `isStatus`
- `scripts/data/active-effects/relationship-tag-data.js` — remove `isStatus`
- `scripts/data/active-effects/story-tag-data.js` — remove `isStatus`
- `scripts/data/active-effects/status-tag-data.js` — remove `isStatus`
- `scripts/item/theme/theme-data.js` — return `ActiveEffect[]` from getters, remove `themeTag` synthesis
- `scripts/item/story-theme/story-theme-data.js` — return `ActiveEffect[]` from getters
- `scripts/item/backpack/backpack-data.js` — return `ActiveEffect[]` from getters
- `scripts/actor/effect-tags-mixin.js` — slim down to `tags` + `statuses` returning `ActiveEffect[]`
- `scripts/actor/hero/hero-data.js` — replace `rollableTags`/`effectTags`/`allTags`/etc. with structured getters
- `scripts/actor/fellowship/fellowship-data.js` — update getters to return `ActiveEffect[]`
- `scripts/actor/hero/hero-sheet.js` — update `_buildAllRollTags`, `_prepareContext`, `#onSelectTag`
- `scripts/actor/fellowship/fellowship-sheet.js` — update to read AEs directly
- `scripts/sheets/base-actor-sheet.js` — remove `_prepareStoryTags`, update consumers
- `scripts/apps/roll-dialog.js` — replace `characterTags` array with Map-based state, simplify `_prepareContext`
- `scripts/apps/story-tag-sidebar.js` — read from actor getters, ephemeral AEs for settings tags
- `scripts/apps/roll.js` — update `filterTags` and `calculatePower` for AE-based input
- `scripts/apps/spend-power.js` — update to read `ActiveEffect[]` from `scratchedTags`
- `templates/partials/play-tag.html` — update to read AE properties
- `templates/partials/play-theme-tags.html` — update to iterate AEs
- `templates/apps/roll-dialog.html` — update section structure
- `templates/actor/hero-play.html` — update to read from structured getters
- `templates/actor/hero.html` — update edit mode to read from structured getters
- `templates/actor/fellowship-play.html` — update to read AEs

---

## Task 1: Remove `isStatus` from all AE data models

**Files:**
- Modify: `scripts/data/active-effects/power-tag-data.js`
- Modify: `scripts/data/active-effects/weakness-tag-data.js`
- Modify: `scripts/data/active-effects/fellowship-tag-data.js`
- Modify: `scripts/data/active-effects/relationship-tag-data.js`
- Modify: `scripts/data/active-effects/story-tag-data.js`
- Modify: `scripts/data/active-effects/status-tag-data.js`

- [ ] **Step 1: Remove `isStatus` getter from all 6 files**

In each file, delete the `get isStatus()` getter entirely:

`power-tag-data.js` — remove lines 15-17:
```js
get isStatus() {
    return false;
}
```

`weakness-tag-data.js` — remove lines 10-12.
`fellowship-tag-data.js` — remove lines 15-17.
`relationship-tag-data.js` — remove lines 15-17.
`story-tag-data.js` — remove lines 17-19.
`status-tag-data.js` — remove lines 20-22.

- [ ] **Step 2: Find and replace all `isStatus` consumer references**

Search for `isStatus` across the codebase and replace:
- `e.system?.isStatus` → `e.type === "status_tag"`
- `effect.system?.isStatus` → `effect.type === "status_tag"`
- `effect.system.isStatus` → `effect.type === "status_tag"`

Key files to check:
- `scripts/actor/effect-tags-mixin.js` lines 19, 33
- `scripts/actor/hero/hero-data.js` line 158, 168
- `scripts/sheets/base-actor-sheet.js` line 368, 676
- `scripts/apps/story-tag-sidebar.js` lines 138, 141

---

## Task 2: Update Item Data Models to return `ActiveEffect[]`

**Files:**
- Modify: `scripts/item/theme/theme-data.js`
- Modify: `scripts/item/story-theme/story-theme-data.js`
- Modify: `scripts/item/backpack/backpack-data.js`

- [ ] **Step 1: Update ThemeData getters**

Replace all tag getters in `scripts/item/theme/theme-data.js` to return `ActiveEffect[]` directly:

```js
get powerTags() {
    return this.parent.effects
        .filter((e) => e.type === "power_tag" || e.type === "fellowship_tag");
}

get weaknessTags() {
    return this.parent.effects
        .filter((e) => e.type === "weakness_tag");
}

get allTags() {
    return [...this.parent.effects]
        .filter((e) => e.type === "power_tag" || e.type === "fellowship_tag" || e.type === "weakness_tag");
}

get activatedPowerTags() {
    return this.powerTags.filter((e) => e.active);
}

get availablePowerTags() {
    return this.activatedPowerTags;
}
```

Remove the `themeTag` getter entirely — the title tag is now a real AE on the theme item.

Remove the `titleCase` import if it was only used by `themeTag`.

- [ ] **Step 2: Update StoryThemeData getters**

Apply the same changes to `scripts/item/story-theme/story-theme-data.js`:

```js
get powerTags() {
    return this.parent.effects
        .filter((e) => e.type === "power_tag" || e.type === "fellowship_tag");
}

get weaknessTags() {
    return this.parent.effects
        .filter((e) => e.type === "weakness_tag");
}

get allTags() {
    return [...this.parent.effects]
        .filter((e) => e.type === "power_tag" || e.type === "fellowship_tag" || e.type === "weakness_tag");
}

get availablePowerTags() {
    return this.powerTags.filter((e) => e.active);
}
```

Remove `themeTag` getter.

- [ ] **Step 3: Update BackpackData getters**

Update `scripts/item/backpack/backpack-data.js`:

```js
get tags() {
    return this.parent.effects
        .filter((e) => e.type === "story_tag");
}

get activeTags() {
    return this.tags.filter((e) => e.active);
}
```

---

## Task 3: Slim down the EffectTagsMixin

**Files:**
- Modify: `scripts/actor/effect-tags-mixin.js`

- [ ] **Step 1: Replace mixin with slim version**

Replace the entire mixin content:

```js
/**
 * Mixin that adds universal tag/status getters to actor data models.
 * Returns ActiveEffect[] directly — no plain object mapping.
 * @param {typeof TypeDataModel} Base
 * @returns {typeof TypeDataModel}
 */
export function EffectTagsMixin(Base) {
    return class extends Base {
        /**
         * All story_tag effects on this actor.
         * @returns {ActiveEffect[]}
         */
        get tags() {
            return [...this.parent.allApplicableEffects()]
                .filter((e) => e.type === "story_tag");
        }

        /**
         * All status_tag effects on this actor.
         * @returns {ActiveEffect[]}
         */
        get statuses() {
            return [...this.parent.allApplicableEffects()]
                .filter((e) => e.type === "status_tag");
        }
    };
}
```

---

## Task 4: Restructure HeroData getters

**Files:**
- Modify: `scripts/actor/hero/hero-data.js`

This is the largest task. Replace the monolithic `rollableTags` and associated getters with structured getters.

- [ ] **Step 1: Replace tag getters with structured versions**

Remove these getters: `allTags`, `powerTags`, `weaknessTags`, `availablePowerTags`, `backpack` (the one returning `backpack.system.tags`), `effectTags`, `storyTags`, `rollableTags`.

Remove the private cache fields: `#cachedThemeItems`, `#cachedEffectTags`.

Add these new getters:

```js
/**
 * Own non-fellowship themes, each with their tag AEs.
 * @returns {{ theme: Item, tags: ActiveEffect[] }[]}
 */
get themes() {
    return this.parent.items
        .filter((i) => (i.type === "theme" && !i.system.isFellowship) || i.type === "story_theme")
        .sort((a, b) => a.sort - b.sort)
        .map((theme) => ({
            theme,
            tags: [...theme.effects].filter((e) =>
                e.type === "power_tag" || e.type === "weakness_tag" || e.type === "fellowship_tag"
            ),
        }));
}

/**
 * Story tag AEs from the hero's backpack item.
 * @returns {ActiveEffect[]}
 */
get backpack() {
    const backpack = this.parent.items.find((i) => i.type === "backpack");
    if (!backpack) return [];
    return [...backpack.effects].filter((e) => e.type === "story_tag");
}

/**
 * Everything from the fellowship actor: theme groups + story tags/statuses.
 * @returns {{ themes: { theme: Item, tags: ActiveEffect[] }[], tags: ActiveEffect[] }}
 */
get fellowship() {
    const actor = this.fellowshipActor;
    if (!actor) return { themes: [], tags: [] };
    const themes = actor.items
        .filter((i) => i.type === "theme" || i.type === "story_theme")
        .map((theme) => ({
            theme,
            tags: [...theme.effects].filter((e) =>
                e.type === "power_tag" || e.type === "weakness_tag" || e.type === "fellowship_tag"
            ),
        }));
    const tags = [...actor.allApplicableEffects()]
        .filter((e) => e.type === "story_tag" || e.type === "status_tag");
    return { themes, tags };
}

/**
 * Relationship tag AEs on the hero.
 * @returns {ActiveEffect[]}
 */
get relationships() {
    return [...this.parent.effects]
        .filter((e) => e.type === "relationship_tag");
}

/**
 * Status tag AEs on the hero actor only (not fellowship).
 * @returns {ActiveEffect[]}
 */
get statuses() {
    return [...this.parent.effects]
        .filter((e) => e.type === "status_tag");
}

/**
 * All scratched AEs across hero + fellowship items.
 * @returns {ActiveEffect[]}
 */
get scratchedTags() {
    const scratched = [];
    const itemSources = [...this.parent.items];
    const fellowship = this.fellowshipActor;
    if (fellowship) itemSources.push(...fellowship.items);
    for (const item of itemSources) {
        for (const effect of item.effects) {
            if (effect.system?.isScratched && effect.type !== "weakness_tag") {
                scratched.push(effect);
            }
        }
    }
    for (const effect of this.parent.effects) {
        if (effect.system?.isScratched) {
            scratched.push(effect);
        }
    }
    return scratched;
}
```

- [ ] **Step 2: Update `relationshipEntries` to use `relationships` getter**

```js
get relationshipEntries() {
    const heroActors = (game.actors ?? []).filter(
        (actor) => actor.type === "hero" && actor.id !== this.parent.id,
    );
    const existing = this.relationships;
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

- [ ] **Step 3: Update `prepareDerivedData`**

Remove cache clearing (no more `#cachedThemeItems`, `#cachedEffectTags`). Update the status computation:

```js
prepareDerivedData() {
    super.prepareDerivedData();
    const highestStatus = this.statuses
        .filter((e) => e.active)
        .reduce((max, e) => Math.max(max, e.system.currentTier), 0);
    this.limit.value = this.limit.max - highestStatus;
}
```

- [ ] **Step 4: Update `toggleScratchTag` to handle the themeTag case**

The old `themeTag` case (toggling scratch on the theme Item itself) is no longer needed since the title tag is now a real AE. Simplify:

```js
async toggleScratchTag(tag) {
    if (Hooks.call("litm.preTagScratched", this.parent, tag) === false) return;
    const effect = this.#findEffect(tag.id);
    if (!effect) return;
    await effect.system.toggleScratch();
    Hooks.callAll("litm.tagScratched", this.parent, tag);
}
```

Remove the `themeTag` branch and the `tag.type` switch entirely — everything is an AE now.

---

## Task 5: Update FellowshipData

**Files:**
- Modify: `scripts/actor/fellowship/fellowship-data.js`

- [ ] **Step 1: Update getters to return AEs**

```js
import { EffectTagsMixin } from "../effect-tags-mixin.js";

export class FellowshipData extends EffectTagsMixin(foundry.abstract.TypeDataModel) {
    static defineSchema() {
        const fields = foundry.data.fields;
        return {
            description: new fields.HTMLField({ initial: "" }),
        };
    }

    get theme() {
        return this.parent.items.find(
            (item) => item.type === "theme" && item.system.isFellowship,
        );
    }

    get storyThemes() {
        return this.parent.items.filter((item) => item.type === "story_theme");
    }

    get allTags() {
        const items = [this.theme, ...this.storyThemes].filter(Boolean);
        return items.flatMap((item) => [...item.effects]
            .filter((e) => e.type === "power_tag" || e.type === "weakness_tag" || e.type === "fellowship_tag")
        );
    }

    async scratchTag(tagType, tagId) {
        for (const item of this.parent.items) {
            const effect = item.effects.get(tagId);
            if (effect) {
                await effect.system.toggleScratch();
                return;
            }
        }
    }
}
```

---

## Task 6: Update HeroSheet

**Files:**
- Modify: `scripts/actor/hero/hero-sheet.js`

- [ ] **Step 1: Update `_buildAllRollTags` to flatten structured getters**

Replace the method to flatten the new structured getters into a single AE array:

```js
_buildAllRollTags() {
    const sys = this.system;
    const themeEffects = sys.themes.flatMap((g) => g.tags);
    const backpackEffects = sys.backpack;
    const fellowshipEffects = [
        ...sys.fellowship.themes.flatMap((g) => g.tags),
        ...sys.fellowship.tags,
    ];
    const relationshipEffects = sys.relationships;
    return [...themeEffects, ...backpackEffects, ...fellowshipEffects, ...relationshipEffects];
}
```

- [ ] **Step 2: Update `_prepareContext` to pass structured getters to template**

In the hero sheet's `_prepareContext`, replace any `rollableTags`, `allTags`, `storyTags` references with the new structured getters:

```js
// In the play-mode context
context.themes = this.system.themes;
context.backpack = this.system.backpack;
context.fellowship = this.system.fellowship;
context.relationships = this.system.relationships;
context.statuses = this.system.statuses;
```

Remove the call to `_prepareStoryTags()`.

- [ ] **Step 3: Update `#onSelectTag` to use `effect.active`**

Replace any manual `!disabled && !isScratched` checks with `effect.active`. Replace `tagFromSystem.toObject()` with direct AE lookup:

Find the tag by searching the structured getters:
```js
const allEffects = this._buildAllRollTags();
const tagFromSystem = allEffects.find((e) => e.id === tagId);
```

---

## Task 7: Update base-actor-sheet

**Files:**
- Modify: `scripts/sheets/base-actor-sheet.js`

- [ ] **Step 1: Remove `_prepareStoryTags`**

Delete the `_prepareStoryTags()` method entirely (lines 364-380).

- [ ] **Step 2: Update any code that called `_prepareStoryTags`**

Search for `_prepareStoryTags` in:
- `scripts/actor/hero/hero-sheet.js` — remove the call, use structured getters instead
- `scripts/actor/fellowship/fellowship-sheet.js` — update to use `system.tags` and `system.statuses` directly

- [ ] **Step 3: Update `_onAdjustProgress` and `_onDropTagOrStatus`**

Replace `effect.system?.isStatus` with `effect.type === "status_tag"` in any remaining references.

---

## Task 8: Rewrite Roll Dialog state management

**Files:**
- Modify: `scripts/apps/roll-dialog.js`

- [ ] **Step 1: Replace `characterTags` array with tag Map**

In the constructor, replace `this.characterTags = options.characterTags` with a Map:

```js
this.#selectionState = new Map(); // Map<effectId, {state, contributorId, sourceUuid}>
this.#characterEffects = options.characterTags ?? []; // ActiveEffect[] for reference
```

Add getter for the selection state:
```js
getTagState(effectId) {
    return this.#selectionState.get(effectId) ?? { state: "", contributorId: null, sourceUuid: null };
}

setTagState(effectId, state, contributorId = null, sourceUuid = null) {
    this.#selectionState.set(effectId, { state, contributorId, sourceUuid });
}
```

- [ ] **Step 2: Update `statuses` getter**

Replace to return only hero statuses (not scene statuses):
```js
get heroStatuses() {
    if (!this.actor) return [];
    return this.actor.system.statuses.filter((e) => e.active);
}
```

- [ ] **Step 3: Update `tags` getter to return scene-level ephemeral AEs**

```js
get sceneTags() {
    const { tags } = game.litmv2.storyTags ?? ui.combat ?? { tags: [] };
    return tags
        .filter((tag) => tag.values?.every((v) => !v))
        .map((tag) => new ActiveEffect.implementation({
            _id: tag.id,
            name: tag.name,
            type: "story_tag",
            system: {
                isScratched: tag.isScratched ?? false,
                isSingleUse: tag.isSingleUse ?? false,
                isHidden: tag.hidden ?? false,
            },
        }));
}

get sceneStatuses() {
    const { tags } = game.litmv2.storyTags ?? ui.combat ?? { tags: [] };
    return tags
        .filter((tag) => tag.values?.some((v) => !!v))
        .map((tag) => new ActiveEffect.implementation({
            _id: tag.id,
            name: tag.name,
            type: "status_tag",
            system: {
                tiers: tag.values ?? [false, false, false, false, false, false],
                isHidden: tag.hidden ?? false,
            },
        }));
}
```

- [ ] **Step 4: Simplify `_prepareContext` owner path**

Replace the entire 300-line grouping logic with direct reads from structured getters:

```js
// Owner view context
const sys = this.actor.system;
const stateFor = (effect) => {
    const s = this.getTagState(effect.id);
    return {
        state: s.state,
        contributorId: s.contributorId,
        states: effect.system.allowedStates,
    };
};

context.themes = sys.themes.map((g) => ({
    theme: g.theme,
    tags: g.tags.filter((e) => e.active).map((e) => ({ effect: e, ...stateFor(e) })),
}));
context.backpack = sys.backpack.filter((e) => e.active)
    .map((e) => ({ effect: e, ...stateFor(e) }));
context.fellowship = {
    themes: sys.fellowship.themes.map((g) => ({
        theme: g.theme,
        tags: g.tags.filter((e) => e.active).map((e) => ({ effect: e, ...stateFor(e) })),
    })),
    tags: sys.fellowship.tags.filter((e) => e.active)
        .map((e) => ({ effect: e, ...stateFor(e) })),
};
context.relationships = sys.relationships.filter((e) => e.active)
    .map((e) => ({ effect: e, ...stateFor(e) }));
context.heroStatuses = sys.statuses.filter((e) => e.active)
    .map((e) => ({ effect: e, ...stateFor(e) }));
context.sceneTags = this.sceneTags.map((e) => ({ effect: e, ...stateFor(e) }));
context.sceneStatuses = this.sceneStatuses.map((e) => ({ effect: e, ...stateFor(e) }));
```

- [ ] **Step 5: Update the roll submission to use Map state**

In the `roll()` static method, collect selected tags from the Map:

```js
const allEffects = [...this.#characterEffects, ...this.sceneTags, ...this.sceneStatuses, ...this.heroStatuses];
const selected = [];
for (const effect of allEffects) {
    const s = this.getTagState(effect.id);
    if (s.state) selected.push({ effect, state: s.state, sourceUuid: s.sourceUuid });
}
```

Then pass to `LitmRoll.filterTags` and `calculatePower` with the effects and their states.

- [ ] **Step 6: Update post-roll scratch logic**

```js
for (const { effect, state, sourceUuid } of selected) {
    const shouldScratch = state === "scratched" || (effect.system?.isSingleUse && state);
    if (!shouldScratch) continue;
    if (!sourceUuid || sourceUuid === this.actor.uuid) {
        await effect.system.toggleScratch();
    } else {
        Sockets.dispatch("scratchTag", { uuid: sourceUuid, effectId: effect.id });
    }
}
```

---

## Task 9: Update Roll class

**Files:**
- Modify: `scripts/apps/roll.js`

- [ ] **Step 1: Update `filterTags` to work with AE-state pairs**

The input is now `[{effect, state}]`. Update:

```js
static filterTags(selections) {
    const scratchedTags = [];
    const powerTags = [];
    const weaknessTags = [];
    const positiveStatuses = [];
    const negativeStatuses = [];

    for (const { effect, state } of selections) {
        if (!state) continue;
        const isStatus = effect.type === "status_tag";
        if (state === "scratched") scratchedTags.push(effect);
        else if (isStatus && state === "positive") positiveStatuses.push(effect);
        else if (isStatus && state === "negative") negativeStatuses.push(effect);
        else if (state === "positive") powerTags.push(effect);
        else if (state === "negative") weaknessTags.push(effect);
    }
    return { scratchedTags, powerTags, weaknessTags, positiveStatuses, negativeStatuses };
}
```

- [ ] **Step 2: Update `calculatePower` for AE-based statuses**

Status values come from `effect.system.currentTier` instead of a `value` field:

```js
const positiveStatusValue = positiveStatuses.reduce(
    (max, e) => Math.max(max, e.system.currentTier), 0
);
const negativeStatusValue = negativeStatuses.reduce(
    (max, e) => Math.max(max, e.system.currentTier), 0
);
```

---

## Task 10: Update Story Tag Sidebar

**Files:**
- Modify: `scripts/apps/story-tag-sidebar.js`

- [ ] **Step 1: Update `actors` getter to use data model getters**

Replace the `allApplicableEffects()` traversal with reads from the actor's data model:

```js
tags: [
    ...actor.system.tags,
    ...actor.system.statuses,
].filter((e) => !e.disabled)
 .filter((e) => game.user.isGM || !e.system?.isHidden)
 .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
 .map((e) => {
     const isStatus = e.type === "status_tag";
     return {
         id: e._id,
         effect: e,
         name: e.name,
         type: isStatus ? "status" : "tag",
         isScratched: e.system?.isScratched ?? false,
         isSingleUse: isStatus ? false : (e.system?.isSingleUse ?? false),
         value: isStatus ? (e.system?.currentTier ?? 0) : 1,
         values: isStatus ? (e.system?.tiers ?? new Array(6).fill(false)) : new Array(6).fill(false),
         hidden: e.system?.isHidden ?? false,
         limitId: e.system?.limitId ?? null,
     };
 }),
```

Note: The sidebar still maps to a display shape because it has its own complex rendering needs (limit grouping, tier box display, drag-and-drop serialization). The AE reference is preserved via the `effect` property for mutations.

- [ ] **Step 2: Update `tags` getter for ephemeral AEs**

Convert settings-stored tags to ephemeral AEs at read time:

```js
get tags() {
    return this.config.tags
        .filter((tag) => game.user.isGM || !tag.hidden)
        .map((tag) => {
            const isStatus = tag.type === "status";
            const effect = new ActiveEffect.implementation({
                _id: tag.id,
                name: tag.name,
                type: isStatus ? "status_tag" : "story_tag",
                system: isStatus
                    ? { tiers: tag.values ?? [false, false, false, false, false, false], isHidden: tag.hidden ?? false, limitId: tag.limitId ?? null }
                    : { isScratched: tag.isScratched ?? false, isSingleUse: tag.isSingleUse ?? false, isHidden: tag.hidden ?? false, limitId: tag.limitId ?? null },
            });
            return { ...tag, effect };
        });
}
```

---

## Task 11: Update SpendPowerApp

**Files:**
- Modify: `scripts/apps/spend-power.js`

- [ ] **Step 1: Update to consume `ActiveEffect[]` from `scratchedTags`**

`scratchedTags` now returns `ActiveEffect[]` instead of plain objects. Update the app to read AE properties:

```js
// Where it previously read tag.name, tag.id from plain objects:
// Now read effect.name, effect.id from ActiveEffect documents
const scratched = this.actor.system.scratchedTags;
// Use effect.name, effect.id, effect.system.isScratched directly
```

---

## Task 12: Update Templates

**Files:**
- Modify: `templates/partials/play-tag.html`
- Modify: `templates/partials/play-theme-tags.html`
- Modify: `templates/apps/roll-dialog.html`
- Modify: `templates/actor/hero-play.html`
- Modify: `templates/actor/hero.html`
- Modify: `templates/actor/fellowship-play.html`

- [ ] **Step 1: Update `play-tag.html`**

The partial receives either an AE directly or a `{effect, state, states}` wrapper from the roll dialog. Update to read AE properties:

Where it previously read `tag.name`, `tag.type`, `tag.isScratched`, etc., update to:
- `tag.effect.name` or `tag.name` (depending on context)
- `tag.effect.type` for type checks
- `tag.effect.system.isScratched` for scratch state
- `tag.effect.active` for active state

The exact changes depend on how each template invokes the partial — read each template and update the data access paths.

- [ ] **Step 2: Update `play-theme-tags.html`**

Currently iterates `system.powerTags` and `system.weaknessTags` which were plain objects. Now they're `ActiveEffect[]`:

```handlebars
{{#each system.powerTags}}
{{#if this.active}}
{{> "systems/litmv2/templates/partials/play-tag.html" tag=this}}
{{/if}}
{{/each}}
```

- [ ] **Step 3: Update `roll-dialog.html`**

Replace the template sections to match the new context structure:
- `characterTagGroups` → `themes` (iterate theme groups)
- `fellowshipTagGroups` → `fellowship.themes` + `fellowship.tags`
- `storyTagGroups` → `sceneTags` + `sceneStatuses`

Each tag in the roll dialog template is a `{effect, state, states}` wrapper. The partial reads `tag.effect.name`, `tag.effect.system.allowedStates`, `tag.state`, etc.

- [ ] **Step 4: Update hero sheet templates**

`hero-play.html` — update to iterate `themes`, `backpack`, `fellowship`, `statuses` from context.

`hero.html` (edit mode) — update to iterate the same structured getters, showing all tags regardless of active state.

- [ ] **Step 5: Update fellowship sheet template**

`fellowship-play.html` — update to read AE properties directly from the fellowship data getters.

---

## Task 13: Create title tag AEs for existing themes

**Files:**
- Modify: `scripts/system/migrations.js`
- Modify: `scripts/item/litm-item.js`

- [ ] **Step 1: Update `LitmItem.migrateData` to create title tag AE**

In `LitmItem.#migrateThemeTags`, after creating power/weakness tag AEs, also check if a title tag AE exists. If not, create one:

```js
// After existing tag migration, check for title tag
const hasTitleTag = effects.some((e) =>
    (e.type === "power_tag" || e.type === "fellowship_tag") &&
    e.name === source.name
);
if (!hasTitleTag && source.name) {
    const isFellowship = source.system?.isFellowship ?? false;
    effects.push({
        name: source.name,
        type: isFellowship ? "fellowship_tag" : "power_tag",
        disabled: false,
        system: { question: null, isScratched: source.system?.isScratched ?? false },
    });
}
```

- [ ] **Step 2: Add world migration for existing themes**

Add a migration step that creates title tag AEs for themes that don't have one yet. The migration iterates all actors' theme items and creates the AE if missing.

---

## Task 14: Update remaining consumers

**Files:**
- Modify: `scripts/actor/fellowship/fellowship-sheet.js`
- Modify: `scripts/actor/challenge/challenge-sheet.js`
- Modify: `scripts/actor/journey/journey-sheet.js`
- Modify: `scripts/apps/welcome-overlay.js`
- Modify: `scripts/system/sample-hero.js`
- Modify: `scripts/system/hooks/chat-hooks.js`

- [ ] **Step 1: Update fellowship-sheet.js**

Replace references to `system.storyTags`, `system.statuses` (old plain-object getters) with the new AE-returning getters. Update template context accordingly.

- [ ] **Step 2: Update challenge-sheet.js and journey-sheet.js**

Replace any `effectTags` references with `system.tags` and `system.statuses` from the mixin.

- [ ] **Step 3: Update remaining files**

For each of `welcome-overlay.js`, `sample-hero.js`, `chat-hooks.js`:
- Replace any `allTags`, `powerTags`, `weaknessTags` references that expect plain objects with the new AE-based access pattern
- Replace `fromFellowship` flag usage with direct getter access
- Remove `themeTag` type references — title tags are now regular `power_tag`/`fellowship_tag` AEs

---

## Follow-up (not in this plan)

- **`getRollData()` redesign** — future API for modules/macros to inspect hero state
- **Ephemeral AE write-back** — `toggleScratch()` routing for sidebar settings-stored tags
- **`TagStringSyncMixin` update** — may need adjustment for new type names in the string↔AE bridge
