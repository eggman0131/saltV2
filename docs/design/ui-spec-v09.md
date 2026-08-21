# Salt 2.0 — UI Primitives Specification (v0.9)

**Status:** Planning  
**Scope:** `@salt/ui-components` — `Chip`, `ChipGroup`  
**Audience:** AI code-generation agents + human contributors

> Rule: If anything is missing or ambiguous → STOP → extend this spec → regenerate.  
> No invention beyond what is written here.

This document extends **v0.2**, **v0.3**, **v0.4**, **v0.5**, **v0.6**, **v0.7** and **v0.8**.  
All global rules, architecture, naming, styling, and testing conventions from v0.2 remain in force.

---

## 0. v0.9 Scope

v0.9 introduces:

- **`Chip`** — a pill-shaped filter toggle, and the dashed "+N more" expander that ends a row of them (§8.23)
- **`ChipGroup`** — the row that holds them (§8.24)

These are **promotions, not inventions**. Every behaviour below already ships in
`apps/web-pwa`; v0.9 gives it a name so the next list gets it right by default
instead of copying whichever hand-roll it happened to find. It changes the
behaviour of no existing component, and adds no capability the pages did not
already have.

One visual change is deliberate and is the whole reason a spec had to decide
anything at all — see §8.23.4.

---

# 8.23 Chip

## 8.23.1 Overview

A small pill that turns one facet of a list on and off. A row of them sits above
a grid and narrows it: a section, an author, a tag.

A chip is not a small `Button`. A button performs an action and returns you to
where you were; a chip **holds a state** you can see across the whole row, and
the row is read as a set — which of these are on. That is why it carries
`aria-pressed` rather than a label that changes, why it is a pill rather than a
rounded rectangle, and why it never carries a leading icon or a spinner.

Consumers today: the recipe list's section, authorship and tag filters.

## 8.23.2 Chip or Button?

| Use | Component |
| --- | --- |
| A facet that is on or off, shown alongside its siblings | `Chip` |
| Anything that navigates, submits, opens or destroys | `Button` |
| A one-off toggle with no row of peers — "show weather on the planner" | `Switch` (v0.2 §8.19) |
| A read-only badge that cannot be pressed | Neither. Nothing needs one yet; add it to this spec before writing it |

## 8.23.3 Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `variant` | `'filter' \| 'expander'` | `'filter'` | See §8.23.5 |
| `pressed` | `boolean` | `false` | Emitted as `aria-pressed`. **`filter` only** — see §8.23.6 |
| `children` | `Snippet` | — | The chip's label. Text only |
| `class` | `string` | — | Merged last via `cn()` (v0.2 §2.3) |

Everything else — `onclick`, `data-testid`, `data-*`, `title`, `disabled` — rides
`...rest` onto the underlying `<button type="button">`, exactly as `Button`
(v0.2 §8.1) does. Passing `data-testid` through is **required**, not incidental:
the recipe list's filters are asserted by `e2e/recipe-author-filter.spec.ts`
through `recipe-kind-filter`, `recipe-author-filter`, `recipe-tag-filter` and
their show-all/show-less siblings.

`Chip` owns no selection state. It renders the state it is handed.

## 8.23.4 Size — one size, and why

Two sizes shipped by accident: `px-3 py-1` on the recipe list's section chips and
`px-2.5 py-1` on its authorship and tag chips, with `font-medium` on the first
and not the second. Same idiom, same page, three rows stacked vertically, no rule
saying which was right.

**The single size is `px-3 py-1 text-xs font-medium`.**

- `px-3` is `salt-button--sm`'s horizontal padding, so a chip row and a row of
  small buttons share one horizontal rhythm.
- `font-medium` is `.salt-button`'s own weight. A chip is pressable, and `text-xs`
  at normal weight would be the lightest interactive text in the app.

No size variant. A second size would re-legitimise the drift this section exists
to end; if a future consumer genuinely needs one, it earns a spec amendment
first.

**The permitted visual change:** the recipe list's authorship and tag chips gain
2px of horizontal padding and go from normal to medium weight. Nothing else about
the recipe list moves. This is the only pixel v0.9 is allowed to change, and any
migration PR must call it out.

## 8.23.5 Variants

**`filter`** — the toggle. Solid border, `bg-background`, `text-muted-foreground`,
`hover:bg-muted`. Pressed it fills: `border-primary bg-primary
text-primary-foreground`, and the hover treatment is suppressed, because a
pressed chip that lightens under the cursor reads as though the press came
undone.

**`expander`** — the dashed chip that ends a truncated row: "+3 more", and
"Show less" once expanded. Dashed border, no background, `text-muted-foreground`,
`hover:bg-muted`.

The dashed border is doing real work: it says *this pill is not one of the
things, it is the way to see more of them*. Without it a "+3 more" chip sits in
the row looking like a fourth filter you could turn on.

Both are `<button type="button">`. `expander` is an action, not a state, so it
never carries `aria-pressed` (§8.23.6).

Single-select and multi-select rows use the **same** chip. The difference is
entirely in what the page does on click — see §8.24.2.

## 8.23.6 Accessibility

- `variant="filter"` renders `aria-pressed="true" | "false"` on every chip in the
  row, always both states present. A row where only the on-chips carry the
  attribute reads to a screen reader as a row of buttons with one toggle in it.
- `variant="expander"` renders **no** `aria-pressed`. It reveals more chips; it
  is not itself in a pressed or unpressed state, and claiming otherwise would
  announce "not pressed" for a control that can never be pressed.
- The chip's label is its text content. It needs no `ariaLabel`, and a chip with
  no text is a spec violation rather than something to paper over with one.
- Colour is never the only carrier of the pressed state — `aria-pressed` carries
  it independently, per v0.2 §7.

## 8.23.7 What Chip does not do

- **No leading or trailing icon, no dismiss "×".** A removable chip is a
  different control (it has two hit targets), and nothing needs one.
- **No loading or disabled treatment.** A facet that cannot be applied is not
  rendered — the recipe list drops the whole authorship row when the household
  has one member, rather than showing two dead chips.
- **No count badge.** The recipe list ranks its tag chips by frequency and
  deliberately never shows the number; a chip that could show one would invite
  the opposite.
- **No press-scale.** `.salt-button`'s tap-scale is not inherited. A chip's
  answer to a tap is the fill, which lands on the same frame.

---

# 8.24 ChipGroup

## 8.24.1 Overview

The row a set of chips sits in: `flex flex-wrap gap-1.5`, plus the `role="group"`
and accessible name that make the set legible as a set.

It exists because promoting `Chip` alone would leave every consumer hand-rolling
the same three layout utilities — which is the drift this spec is closing, moved
down one level.

## 8.24.2 What it does not own: selection

`ChipGroup` takes **no value and no change handler**. It is layout and grouping
semantics; the page keeps its own state.

This is deliberate. Single-select (the section row: exactly one chip pressed at
all times) and multi-select (authorship and tags: independent AND-narrowing
toggles) are the same markup and differ only in what the click does. A group that
owned the value would have to model both cardinalities, and would then hold a
second copy of state the page already derives — the recipe list's tag row is
re-faceted from the current result set on every keystroke, and its section is
read back out of the section chips to decide what the grid even contains. The
group would be re-deriving, or fighting, both.

So: the page computes `pressed`, the page handles `onclick`, and the group draws
the row.

## 8.24.3 Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `ariaLabel` | `string \| undefined` | — | Names the set. See §8.24.4. Explicitly `\| undefined` so a consumer whose name is conditional can pass it through under `exactOptionalPropertyTypes`; an explicit `undefined` means the same as omitting it |
| `children` | `Snippet` | — | The chips |
| `class` | `string` | — | Merged last via `cn()`. Outer spacing (`mb-3`) belongs to the page, not the group |

`data-testid` and any other attribute ride `...rest` onto the wrapping `<div>`.

## 8.24.4 Accessibility

`ariaLabel` is optional, and when it is given the group renders `role="group"`
with that name. When it is **omitted the group renders neither** — a bare
`<div>` with the layout classes.

An unnamed `role="group"` announces a boundary and then has nothing to say about
what is inside it, which is noise rather than help. A named group is strongly
preferred and every new consumer should pass one.

> Known gap, deliberately preserved: the recipe list's tag row ships today with
> no `role` and no name, while its section and authorship rows have both. v0.9
> promotes that row **as it is** — naming it would be an accessibility change
> inside a refactor whose acceptance criterion is that nothing changes. Giving it
> a name is a good follow-up and belongs in its own issue.

## 8.24.5 What ChipGroup does not do

- **No overflow handling.** It does not count its children, truncate them, or
  render the "+N more" expander. Which chips are shown is a question about the
  data (the recipe list ranks tags by frequency, then pins the active ones back
  in past the cut so they stay deselectable); a layout wrapper cannot answer it
  and should not pretend to.
- **No roving tabindex.** These are buttons in a wrapping row, not a composite
  widget; Tab reaches each one, which is what a filter row wants.
