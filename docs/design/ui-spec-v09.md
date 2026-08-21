# Salt 2.0 — UI Primitives Specification (v0.9)

**Status:** Planning  
**Scope:** `@salt/ui-components` — `Chip`, `ChipGroup`, `CollapsibleSection`, `DisclosureTrigger`, `DisclosureChevron`  
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
- **`CollapsibleSection`** — a titled section whose body collapses (§8.25)
- **`DisclosureTrigger`** and **`DisclosureChevron`** — the button that carries `aria-expanded`, and the chevron that answers it (§8.26)

These are **promotions, not inventions**. Every behaviour below already ships in
`apps/web-pwa`; v0.9 gives it a name so the next list gets it right by default
instead of copying whichever hand-roll it happened to find. It changes the
behaviour of no existing component, and adds no capability the pages did not
already have.

One visual change is deliberate and is the whole reason a spec had to decide
anything at all — see §8.23.4.

v0.9 changes the behaviour of no existing component. In particular it does
**not** alter `EditableRow` (v0.4 §11) — §8.26.2 says why disclosure did not
become a second axis on it.

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

---

# 8.25 CollapsibleSection

## 8.25.1 Overview

A titled section whose body folds away: a micro-label header with a chevron, an
optional trailing action, and children that are rendered only when open.

Consumers today: the shopping list's aisle groups and its Checked group.

## 8.25.2 Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `title` | `string` | — | The header label. Upper-cased by the style, not by the caller |
| `expanded` | `boolean` | — | Open state. Owned by the page — see §8.25.4 |
| `onToggle` | `() => void` | — | Called on header activation. The section never flips itself |
| `collapsedCount` | `number \| undefined` | — | Rendered as `(N)` **only while collapsed**. Omit for a section that carries its count in the title |
| `action` | `Snippet` | — | Trailing header content — a button that acts on the whole section |
| `triggerTestId` | `string \| undefined` | — | `data-testid` for the header button. See §8.25.5 |
| `children` | `Snippet` | — | The body. Not rendered at all while collapsed |
| `class` | `string` | — | Merged last via `cn()` (v0.2 §2.3) |

Everything else rides `...rest` onto the `<section>`.

## 8.25.3 The body is removed, not hidden

While collapsed the children are not rendered. A collapsed section holds no
focusable descendants and contributes nothing to the accessibility tree, which
is the same rule v0.5 §2 sets for covered navigation chrome: something you
cannot see must not be something you can Tab into.

This is a state change, not a transition. `CollapsibleSection` runs no animation
of its own; the row-level motion (`salt-row-collapse`, v0.2) belongs to the rows
inside it and is untouched.

## 8.25.4 The page owns the open state

`expanded` and `onToggle` are required and there is no internal fallback. The
real consumers keep collapse state for *many* sections at once — the shopping
list holds a `Set` of collapsed aisle ids — and a component that also kept its
own copy would be a second source of truth for something the page must be able
to reset, persist or derive.

## 8.25.5 Why `triggerTestId` is its own prop

`...rest` lands on the `<section>`, but the thing a test clicks is the header
button, one level in. Without a way to name it, migrating a hand-rolled section
onto this component would silently drop the testid the suite depends on —
`shopping-checked-toggle` is clicked by `e2e/shopping-list-happy-path.spec.ts`.
An explicit prop is better than a `triggerProps` bag: exactly one attribute is
ever needed there, and a bag invites the rest of the button's API to leak.

## 8.25.6 Accessibility

The header is a `<button type="button">` carrying `aria-expanded`. It fills the
header row, so the whole width of the header is the hit target — a micro-label
is a small thing to hit otherwise. `aria-controls` is deliberately **not** set:
`aria-expanded` alone is the complete disclosure contract, and an id would have
to be minted and threaded for no announced benefit.

The chevron is decorative; the header's accessible name is its text.

## 8.25.7 What CollapsibleSection does not do

- **No accordion.** Sections know nothing about their siblings; "only one open
  at a time" is a page policy and belongs where the state lives.
- **No count of its own children.** `collapsedCount` is passed in, because the
  number the shopping list shows is rows-in-this-aisle, which is not the same as
  how many elements the snippet happens to render.
- **No animation.** See §8.25.3.

---

# 8.26 DisclosureTrigger and DisclosureChevron

## 8.26.1 Overview

Two small pieces for the disclosure that is **not** a section: a row that opens
to reveal detail underneath it.

- **`DisclosureTrigger`** — `<button type="button">` carrying `aria-expanded`.
  It owns the ARIA contract and nothing else; layout classes come from the
  caller.
- **`DisclosureChevron`** — `ChevronDown` when open, `ChevronRight` when closed,
  at a given `size`.

Consumer today: the shopping list's combined rows, which reveal a
per-contributor breakdown. `CollapsibleSection` is built from the same two.

## 8.26.2 Why not `expanded` on `EditableRow`

The obvious alternative was to give `EditableRow` (v0.4 §11) an `expanded` prop
and a children snippet, keeping one row concept. It does not fit, and forcing it
would have meant rewriting `EditableRow` into a different component:

- The shopping list's combined row is not an `EditableRow`. It is a `<div>`, not
  an `<li>`; it carries a `CanonIcon` and a check-off control as siblings of the
  label; and it has no `selected` / `onToggleSelect` at all.
- **The revealed content is a sibling of the row, not a child of it.** The row
  sits inside a collapse shell that animates the check-off; the breakdown must
  render *outside* that shell or it would animate away with the row. A component
  whose root is the row cannot render content outside its own root.
- The trigger is a *region* of the row — the label column — while the icon and
  the check-off button beside it must stay outside the button, or tapping
  "done" would also toggle the disclosure.

So disclosure stays separable from the row. `EditableRow` keeps one axis
(selection), and a row that needs both composes them.

## 8.26.3 Props

`DisclosureTrigger`

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `expanded` | `boolean` | — | Rendered as `aria-expanded` |
| `children` | `Snippet` | — | The trigger's content, including where the chevron sits |
| `class` | `string` | — | The caller's layout. The trigger ships none of its own |

`onclick`, `data-testid` and the rest ride `...rest` onto the button.

`DisclosureChevron`

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `expanded` | `boolean` | — | Picks the glyph |
| `size` | `number` | `14` | Pixels. 14 for a section header, 12 inside a row's sub-label |

`DisclosureChevron` takes **no `class`**. It is a glyph inside a trigger the
caller already styles, neither consumer needs to nudge it, and `Icon` (v0.2
§8.12) declares `class?: string` — which under `exactOptionalPropertyTypes`
cannot be handed a conditional one. Widening a v0.2 primitive to forward a prop
nobody uses is the wrong trade; add it here when something actually needs it.

`expanded` is a plain prop on both rather than a shared context. The two are
frequently far apart in the markup — in a combined row the chevron sits in the
trigger's second line while the revealed content is outside the row entirely —
and the caller always has the boolean in hand, so a context would add a
provider, a lifetime and a failure mode to save passing one prop.

## 8.26.4 What they do not do

- **No `DisclosureContent`.** The revealed content is `{#if expanded}` and a
  `<div>` the caller already styles. A wrapper for that would add a component
  without removing a decision.
- **No open state.** Like `CollapsibleSection` (§8.25.4), and for the same
  reason: the shopping list keeps a `Set` of expanded row keys.
- **No `aria-controls`.** Same reasoning as §8.25.6.
- **`DisclosureChevron` renders no button.** It is a glyph. Putting it inside
  something clickable is the caller's job, which is what lets it sit mid-sentence
  in a row's sub-label.
