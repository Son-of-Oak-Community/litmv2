# Toggle Fellowship Setting — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a world-scoped `useFellowship` setting (default `true`) that lets the GM disable the fellowship actor concept entirely — no auto-creation, no fellowship UI in hero sheets, no sidebar inclusion, no relationship tags.

**Architecture:** A single boolean setting gates all fellowship behavior. When disabled, `registerFellowshipHooks()` skips all hook registration except hiding fellowship from the create-actor dialog; `game.litmv2.fellowship` returns `null`; hero sheet context passes `hasFellowship: false` to templates; the sidebar skips auto-including the fellowship UUID. The setting uses `requiresReload: true` since hooks register once at startup.

**Tech Stack:** FoundryVTT v14 ApplicationV2, Handlebars templates, FoundryVTT settings API.

**Rules context:** The Legend in the Mist core rules explicitly support solo play (1 Hero, no fellowship). Relationship tags are a fellowship mechanic ("Fellowship relationship tags") — they should be hidden when fellowship is disabled.

---

### Task 1: Register the `useFellowship` Setting

**Files:**
- Modify: `scripts/system/settings.js` (add getter + registration)
- Modify: `lang/en.json` (add localization keys)

- [ ] **Step 1: Add the static getter to `LitmSettings`**

In `scripts/system/settings.js`, add after the `heroLimit` getter (line 38):

```javascript
static get useFellowship() {
	return game.settings.get("litmv2", "use_fellowship");
}
```

- [ ] **Step 2: Register the setting**

In `scripts/system/settings.js`, inside `register()`, add after the `hero_limit` registration block (after line 148):

```javascript
game.settings.register("litmv2", "use_fellowship", {
	name: "LITM.Settings.use_fellowship",
	hint: "LITM.Settings.use_fellowship_hint",
	scope: "world",
	config: true,
	type: Boolean,
	default: true,
	requiresReload: true,
});
```

- [ ] **Step 3: Add localization keys**

In `lang/en.json`, inside the `"Settings"` block (after the `hero_limit_hint` line):

```json
"use_fellowship": "Use Fellowship",
"use_fellowship_hint": "Enable the shared Fellowship actor, fellowship themes, and relationship tags. Disable for solo play or games without a fellowship. Requires reload.",
```

- [ ] **Step 4: Verify the setting appears in Foundry's settings UI**

Launch Foundry, open Settings > Configure Settings > System Settings. Confirm "Use Fellowship" appears with the correct name and hint, and defaults to checked.

---

### Task 2: Gate `game.litmv2.fellowship` Getter

**Files:**
- Modify: `litmv2.js:85-88`

- [ ] **Step 1: Add the setting check**

In `litmv2.js`, replace the existing `fellowship` getter (lines 85–88):

```javascript
get fellowship() {
	const id = game.settings?.get("litmv2", "fellowshipId");
	return id ? (game.actors?.get(id) ?? null) : null;
},
```

with:

```javascript
get fellowship() {
	if (!game.settings?.get("litmv2", "use_fellowship")) return null;
	const id = game.settings?.get("litmv2", "fellowshipId");
	return id ? (game.actors?.get(id) ?? null) : null;
},
```

---

### Task 3: Gate Fellowship Hooks

**Files:**
- Modify: `scripts/system/hooks/fellowship-hooks.js`

This is the core change. When `useFellowship` is false, only `_hideFromCreateDialog()` should register (to keep fellowship out of the actor-create dropdown regardless).

- [ ] **Step 1: Add early return in `registerFellowshipHooks()`**

Replace the body of `registerFellowshipHooks()` (lines 4–12):

```javascript
export function registerFellowshipHooks() {
	_ensureFellowshipSingleton();
	_blockDuplicateFellowship();
	_blockFellowshipDeletion();
	_blockFellowshipAsCharacter();
	_hideFromCreateDialog();
	_autoLinkNewHeroes();
	_rerenderHeroSheetsOnFellowshipChange();
}
```

with:

```javascript
export function registerFellowshipHooks() {
	_hideFromCreateDialog();

	if (!LitmSettings.useFellowship) return;

	_ensureFellowshipSingleton();
	_blockDuplicateFellowship();
	_blockFellowshipDeletion();
	_blockFellowshipAsCharacter();
	_autoLinkNewHeroes();
	_rerenderHeroSheetsOnFellowshipChange();
}
```

---

### Task 4: Gate Fellowship in Hero Sheet Context

**Files:**
- Modify: `scripts/actor/hero/hero-sheet.js` (~lines 159–199, ~256–259, ~283–284, ~362–368)

When fellowship is disabled, the sheet should pass empty fellowship data and skip relationship entries.

- [ ] **Step 1: Add `hasFellowship` flag and gate fellowship/relationship context**

In `_prepareContext()`, around lines 159–199 where fellowship and relationship data are prepared, wrap the fellowship-specific logic:

```javascript
const hasFellowship = LitmSettings.useFellowship;

// Prepare fellowship from linked fellowship actor
let fellowship = {};
let fellowshipStoryThemeItems = [];
if (hasFellowship) {
	const fellowshipActor = this.system.fellowshipActor;
	if (fellowshipActor) {
		const fellowshipTheme = fellowshipActor.system.theme;
		fellowship = {
			actorId: fellowshipActor.id,
			actorName: fellowshipActor.name,
			hasTheme: !!fellowshipTheme,
		};
		if (fellowshipTheme) {
			const data = this._prepareThemeData(fellowshipTheme);
			fellowship = {
				...fellowship,
				name: fellowshipTheme.name,
				_id: fellowshipTheme.id,
				id: fellowshipTheme.id,
				img: fellowshipTheme.img,
				themeTag: data.themeTag,
				system: data.system,
			};
		}
	}
	fellowshipStoryThemeItems = fellowshipActor
		? fellowshipActor.items
				.filter((i) => i.type === "story_theme")
				.sort((a, b) => a.sort - b.sort)
		: [];
}
```

Similarly, gate the relationship entries preparation:

```javascript
const relationshipEntries = hasFellowship ? this._prepareRelationshipEntries() : [];
const relationshipVisible = relationshipEntries.filter((entry) =>
	entry.tag.trim(),
);
```

- [ ] **Step 2: Add `hasFellowship` to the return context**

In the return object (around line 273), add `hasFellowship`:

```javascript
return {
	...context,
	// ... existing properties ...
	hasFellowship,
	fellowship,
	fellowshipActorId: hasFellowship ? (fellowshipActor?.id ?? null) : null,
	// ... rest of existing properties ...
};
```

Note: `fellowshipActor` is a local variable that's only defined inside the `if (hasFellowship)` block. Move the variable declaration or use a ternary. The simplest approach: declare `let fellowshipActor = null;` before the `if` block, and assign inside it.

- [ ] **Step 3: Gate fellowship tags in `_buildAllRollTags()`**

In `_buildAllRollTags()` (~line 362–368), gate the fellowship lines:

```javascript
_buildAllRollTags() {
	const sys = this.system;
	const toPlain = (e) => ({
		_id: e._id,
		id: e.id ?? e._id,
		uuid: e.uuid,
		name: e.name,
		type: e.type,
		system: e.system,
		active: e.active,
		themeId: e.parent?.id,
		themeName: e.parent?.name,
	});
	const tags = [
		...sys.themes.flatMap((g) => g.tags),
		...sys.backpack,
		...sys.statuses,
	];
	if (LitmSettings.useFellowship) {
		tags.push(
			...sys.fellowship.themes.flatMap((g) => g.tags),
			...sys.fellowship.tags,
			...sys.relationships.filter((e) => e.name),
		);
	}
	return tags.map(toPlain);
}
```

- [ ] **Step 4: Add import**

Ensure `LitmSettings` is imported at the top of `hero-sheet.js`:

```javascript
import { LitmSettings } from "../../system/settings.js";
```

(Check if it's already imported — if so, skip this step.)

---

### Task 5: Gate Fellowship in Hero Templates

**Files:**
- Modify: `templates/actor/hero.html` (~lines 82–140)
- Modify: `templates/actor/hero-play.html` (~lines 34, 56–106)

- [ ] **Step 1: Gate the edit-mode fellowship fieldset**

In `templates/actor/hero.html`, wrap the fellowship fieldset (starting at line 82) with a `hasFellowship` guard:

```handlebars
{{#if hasFellowship}}
<!-- Relationship Tags & Fellowship -->
<fieldset data-tour="fellowship-section">
	...existing content...
</fieldset>
{{/if}}
```

The entire `<fieldset data-tour="fellowship-section">` block (lines 82 through its closing `</fieldset>`) should be inside the guard.

- [ ] **Step 2: Gate the play-mode fellowship section**

In `templates/actor/hero-play.html`, the outer guard on line 34 currently reads:

```handlebars
{{#if (or relationshipVisible.length fellowship fellowshipActorId momentOfFulfillmentVisible.length)}}
```

Replace with:

```handlebars
{{#if (or (and hasFellowship (or relationshipVisible.length fellowship fellowshipActorId)) momentOfFulfillmentVisible.length)}}
```

This ensures the grid section still renders for Moments of Fulfillment even without fellowship, but the fellowship/relationship content only renders when `hasFellowship` is true.

Then wrap the fellowship fieldset inside (lines 56–104) with:

```handlebars
{{#if hasFellowship}}
<fieldset class="theme-card item" data-tour="fellowship-section">
	...existing content...
</fieldset>
{{/if}}
```

---

### Task 6: Gate Fellowship in Story Tag Sidebar

**Files:**
- Modify: `scripts/apps/story-tag-sidebar.js` (~lines 166–174)

- [ ] **Step 1: Conditionally include fellowship UUID**

In the `actors` getter, the fellowship UUID is pushed unconditionally (lines 171–173):

```javascript
const fellowshipUuid = game.litmv2?.fellowship?.uuid;
const autoUuids = [...userCharacterUuids];
if (fellowshipUuid) autoUuids.push(fellowshipUuid);
```

Since `game.litmv2.fellowship` now returns `null` when disabled (Task 2), this already works — `fellowshipUuid` will be `undefined` and the `if` won't push. **No code change needed here.**

However, the `isUserCharacter` check on line 193 also references `fellowshipUuid`:

```javascript
isUserCharacter:
	userCharacterUuids.has(actor.uuid) || actor.uuid === fellowshipUuid,
```

This is also safe — `fellowshipUuid` will be `undefined`, so the comparison is always `false`. **No change needed.**

- [ ] **Step 2: Verify sidebar behavior**

With fellowship disabled, confirm the sidebar no longer shows the fellowship actor. If a fellowship actor was previously added manually to the sidebar's stored actors list, it will still appear (as any manually-added actor would), but it won't be auto-included or marked as `isUserCharacter`.

---

### Task 7: Gate Fellowship Keybinding

**Files:**
- Modify: `scripts/system/keybindings.js` (~lines 82–104)

- [ ] **Step 1: Add setting check to keybinding handler**

The keybinding already warns when no fellowship actor exists. Add an explicit check for the setting at the top of the `onDown` handler (line 90):

```javascript
onDown: () => {
	if (!LitmSettings.useFellowship) {
		return ui.notifications.warn("LITM.Ui.warn_no_fellowship", {
			localize: true,
		});
	}
	const fellowship = game.actors.find((a) => a.type === "fellowship");
	if (!fellowship) {
		return ui.notifications.warn("LITM.Ui.warn_no_fellowship", {
			localize: true,
		});
	}
	const sheet = fellowship.sheet;
	if (sheet.rendered) return sheet.close();
	return sheet.render(true);
},
```

- [ ] **Step 2: Add import**

Ensure `LitmSettings` is imported at the top of `keybindings.js`:

```javascript
import { LitmSettings } from "./settings.js";
```

(Check if already imported.)

---

### Task 8: Gate Fellowship Tour Registration

**Files:**
- Modify: `scripts/system/tours.js` (~lines 178–182)

- [ ] **Step 1: Conditionally register the fellowship tour**

In `_doRegisterTours()`, make the fellowship tour conditional:

```javascript
const tours = [
	["heroSheetBasics", "tours/hero-sheet-basics.json"],
	["storyTagSidebar", "tours/story-tag-sidebar.json"],
];

if (LitmSettings.useFellowship) {
	tours.push(["fellowship", "tours/fellowship.json"]);
}
```

- [ ] **Step 2: Add import**

Ensure `LitmSettings` is imported at the top of `tours.js`.

---

### Task 9: Smoke Test

- [ ] **Step 1: Test with fellowship enabled (default)**

1. Launch Foundry with the system
2. Confirm fellowship actor is auto-created
3. Open a hero sheet — fellowship section and relationship tags visible
4. Open sidebar — fellowship actor present
5. Open roll dialog — fellowship tag section present (if fellowship has tags)
6. Press `F` — fellowship sheet opens

- [ ] **Step 2: Test with fellowship disabled**

1. In Settings > System Settings, uncheck "Use Fellowship"
2. Reload
3. Confirm **no** new fellowship actor is created (existing one stays but is inert)
4. Open a hero sheet — no fellowship section, no relationship tags
5. Open sidebar — fellowship actor is **not** auto-included
6. Press `F` — warning notification
7. Open roll dialog — no fellowship tag section

- [ ] **Step 3: Test re-enabling**

1. Re-check "Use Fellowship" in settings
2. Reload
3. Confirm the existing fellowship actor is picked up (or a new one created if it was deleted)
4. Hero sheets show fellowship section again
