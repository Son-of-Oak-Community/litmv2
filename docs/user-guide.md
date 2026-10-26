# Legend in the Mist — Player & Narrator Guide

What this Foundry system does for your table, and where to find it. Rules
questions belong to the Core Book; this guide covers the software.

**New here?** Open **Game Settings → Tours** and run *Hero Sheet Basics*,
*Story Tag Sidebar*, *Fellowship* and (Narrators) *Narrator's Call*.

---

## Hotkeys

All of them can be rebound in **Configure Controls → Legend in the Mist**.

| Key | Does |
|-----|------|
| `R` | **Player:** open your Hero's roll window (or ask the Narrator for a roll, if your table requires that). **Narrator:** open the Narrator's Call — pick who rolls. |
| `C` | Open/close the sheet of the selected token, or your own Hero. |
| `T` | Open/close the Tags sidebar window. |
| `F` | Open/close the Fellowship sheet. |
| `E` | Switch the topmost sheet between **Play** and **Edit** mode. |
| `Alt+T` | In a text field, wrap the selection in `[brackets]` — instant tag markup. |
| `Alt+A` | Open your Hero's Actions browser. |

`C`, `T` and the Narrator's `R` bring a buried window to the front rather than
closing it; press again to close.

---

## Hero sheet

Every character sheet has two modes. **Play** is for the session: tags are
clickable chips. **Edit** (`E`, or the toggle in the header) is for writing
themes, tags and notes.

Clicking things in Play mode:

| Gesture | On a tag | On a status |
|---------|----------|-------------|
| Click | Add it to your roll | Add it to your roll |
| `Shift`+Click | Burn it (+3 Power, scratched after the roll) | — |
| `Alt`+Click | Scratch / unscratch it | — |
| Right-Click | — | Reduce it by one tier |

Hovering any chip shows the gestures it supports.

Themes, themebooks and tropes are added by dragging them onto the sheet. Marking
Improve is automatic when you invoke a weakness or relationship tag (unless the
Narrator turned that off — then the chat card offers a **Mark Improve** button).
A full Improve track opens theme advancement.

---

## Rolling

The roll window lists every tag you can invoke — your themes, backpack,
relationships, the Fellowship, and the scene's story tags and statuses. Pick
the ones that apply; Power is totalled live.

**Roll types:** Quick, Detailed, Reaction, Sacrifice.

**After the roll**, the chat card lets you spend Power: give or reduce
statuses, add or scratch tags, discover details. Story tags and statuses on the
card can be **dragged onto a token, an actor, or the Tags window** to apply
them.

### The roll is a shared table

A roll window is not private. When someone has one open, a strip above the
player list shows it — **click it to join** and watch or contribute live.

- **Narrator's Call.** The Narrator picks who rolls (and optionally which
  Action). The roll window opens on that player's screen *and* the Narrator's.
  The Narrator sets the move and Might; the player picks their tags and presses
  Roll.
- **Acting Together.** The Narrator calls a roll for the whole Fellowship. Each
  Hero contributes **one** tag from their own tab; the group may burn only
  **one** tag in total.
- **Hidden things still count.** If a concealed Challenge's tag affects your
  roll, you see "Something unseen" with its value — never silent math.

### When the Narrator controls the dice

Two table settings, independent of each other:

- **Allow Player-Initiated Rolls** (on by default). Off: your Roll button and
  `R` send the Narrator a request card instead; they answer by calling the roll.
- **Require Narrator Approval** (off by default). On: pressing Roll sends the
  roll to the Narrator for approval first. You can also do this voluntarily with
  **Send to Narrator**.

Joining a roll, reacting, Sacrifice and camp actions are always allowed.

---

## Tags, statuses and limits

### The Tags sidebar (`T`)

One place for the scene's story tags and every tracked actor's tags, statuses
and limits. Type into the quick-add box and press Enter:

| You type | You get |
|----------|---------|
| `fog` | story tag |
| `slippery ground!` | single-use story tag |
| `wounded-3` | status at tier 3 |
| `drunk-` | status, tier chosen later |
| `wall:4` | limit with max 4 |

Statuses stack: adding the same status again marks the new tier and shifts
higher if it's taken. When a status linked to a **limit** fills it, the
target is overcome and the Narrator gets a chat notice.

### Tags in journals and descriptions

Write tags in square brackets anywhere text is enriched — journals, Action
descriptions, vignettes — and they render as chips:

| Markup | Chip |
|--------|------|
| `[torch]` | story tag |
| `[torch!]` | single-use story tag |
| `[burning-2]` | status, tier 2 |
| `[guards:3]` | limit, max 3 |
| `[-reckless]` | weakness — drag onto a theme to add it there |

Drag a chip onto an actor or the Tags window to apply it.

---

## Fellowship (`F`)

One shared Fellowship actor per world, created automatically; every Hero is
linked to it. It holds the fellowship theme and story themes. For the
Narrator, its sheet also shows **The Heroes** — every Hero's Quests,
weaknesses and statuses at a glance.

Turn **Use Fellowship** off for solo play or tables without one.

---

## Actions (`Alt+A`)

Actions from the Action Grimoire can be dragged onto a Hero. Each lists the
tags that usually help it — drag tags from your sheet onto its rows to link
them. Rolling an Action opens the roll window with that Action loaded.
Actions also work as `@action` links inside journals.

---

## Camping (Narrator)

The tent button in the Fellowship sheet's header (or a Hero's, without a
Fellowship) opens a camp or sojourn for everyone:

1. **Setup** — name the place, add campsite tags (`[warm fire] [rainy-2]`) and
   Threats (drop vignettes).
2. **Camp actions** — each Hero picks what they do, plus one Quality Time
   action: recover a fellowship tag, rephrase/revive a relationship, or create
   a new one.
3. **Pack up** — each Hero ticks the backpack tags they keep; the rest are
   scratched.

---

## Narrator tools

- **Calling a roll** — the button above the player list, the Tags window
  header, or `R`.
- **Concealment** — hide an actor's column in the Tags sidebar and its
  tokens disappear for players, including ones placed later. A Challenge can
  show an alias (or "???") instead of its name in tokens, tags and chat.
- **Token tags** — tags and statuses show on token hover; players can set
  them to always show, or to statuses only.
- **Moderation** — approve or reject players' rolls from the chat card.

---

## Settings

**Game Settings → Configure Settings → Legend in the Mist.**

World (Narrator):

| Setting | Default | |
|---------|---------|---|
| Hero Limit | 5 | Tier at which a Hero is overcome. Above 5 is homebrew. |
| Theme Limit | 4 | Themes per Hero. |
| Improve Track Length | 3 | Marks needed to advance a theme. |
| Automatic Improve Marking | on | Off: chat card offers a button instead. |
| Allow Player-Initiated Rolls | on | Off: players request rolls. |
| Require Narrator Approval | off | Player rolls wait for approval. |
| Use Fellowship | on | Shared Fellowship actor and relationship tags. |
| Show Camping Threats | on | Threats section in camps. |

Per player:

| Setting | Default | |
|---------|---------|---|
| Themed Dice | on | Custom dice (needs Dice So Nice). |
| Auto Pop-out Tags Sidebar | off | Open the Tags window on load. |
| Token Tags: Statuses Only | off | Hide story/backpack tags on tokens. |
| Always Show Token Tags | off | No hover needed. |
| Colorblind-safe Palette | off | Distinct chip colours for colour vision deficiency. |
