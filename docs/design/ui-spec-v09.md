# Salt 2.0 — UI Primitives Specification (v0.9.2)

**Status:** Planning  
**Scope:** `@salt/ui-components` — `Chip`, `ChipGroup`, `CollapsibleSection`, `DisclosureTrigger`, `DisclosureChevron`, the value-chip surface  
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

v0.9.1 adds one thing that is **not** a promotion:

- **the value chip** — `valueChipVariants()`, a pill *surface* worn by a `Select`,
  `Combobox` or `TextField` so a decision can be read and changed in place
  (§8.27). §8.23.2 left a hole here ("add it to this spec before writing it");
  this is that amendment, and it carries a `frameClass` prop onto `TextField`
  (v0.2 §8.2) and a radius amendment to v0.2 §2.3 with it.

v0.9.2 adds the one thing §8.23.2 explicitly left unbuilt:

- **the static chips** — `variant="fact"` and `variant="tag"`, two
  non-interactive pills that render a `<span>` rather than a `<button>`
  (§8.23.8). §8.23.2's last row said "Nothing needs one yet; add it to this spec
  before writing it"; the recipe detail redraw (issue #878) needs both, and this
  is that amendment. It also narrows `Chip`'s attribute passthrough from
  `HTMLButtonAttributes` to `HTMLAttributes<HTMLElement>` — see §8.23.3.

These are **promotions, not inventions**. Every behaviour below already ships in
`apps/web-pwa`; v0.9 gives it a name so the next list gets it right by default
instead of copying whichever hand-roll it happened to find. It changes the
behaviour of no existing component, and adds no capability the pages did not
already have.

One visual change is deliberate and is the whole reason a spec had to decide
anything at all — see §8.23.4.

v0.9 changes the behaviour of no existing component. In particular it does
**not** alter `EditableRow` (v0.4 §11) — §8.26.2 says why disclosure did not
become a second axis on it. v0.9.1's one addition to an existing component is
`TextField`'s `frameClass`, which changes nothing for a caller that does not
pass it (§8.27.5).

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
| A **current value**, shown as a pill and changeable where it sits | Not a component at all — the value-chip **surface** (§8.27) |
| A **measured attribute** of the thing being read — "Serves 4", "Prep 40 min" | `Chip variant="fact"` (§8.23.8) |
| A **word someone attached** to the thing — a recipe tag | `Chip variant="tag"` (§8.23.8) |

## 8.23.3 Props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `variant` | `'filter' \| 'expander' \| 'fact' \| 'tag'` | `'filter'` | See §8.23.5 and §8.23.8 |
| `pressed` | `boolean` | `false` | Emitted as `aria-pressed`. **`filter` only** — see §8.23.6 |
| `icon` | `Snippet` | — | A leading glyph. **`fact` only** — see §8.23.8 |
| `children` | `Snippet` | — | The chip's label. Text only |
| `class` | `string` | — | Merged last via `cn()` (v0.2 §2.3) |

Everything else — `onclick`, `data-testid`, `data-*`, `title` — rides `...rest`
onto the element the variant renders, exactly as `Button` (v0.2 §8.1) does.
Passing `data-testid` through is **required**, not incidental: the recipe list's
filters are asserted by `e2e/recipe-author-filter.spec.ts` through
`recipe-kind-filter`, `recipe-author-filter`, `recipe-tag-filter` and their
show-all/show-less siblings.

**The passthrough is `HTMLAttributes<HTMLElement>`, not `HTMLButtonAttributes`**
(amended in v0.9.2). Two of the four variants render a `<span>`, and a type that
advertised `disabled`, `type` or `form` would be offering a page attributes the
element it lands on cannot honour. Nothing is lost: `disabled` was the only
button-only attribute this section ever named, §8.23.7 has always said a chip has
no disabled treatment, and no call site passed one.

`ChipProps` is a **discriminated union on `variant`**, so a `fact` cannot be
handed `pressed`, a `tag` cannot be handed an `icon`, and neither can be handed
an `onclick`. Every member declares every Salt-owned prop — the disallowed ones
typed `never` — which is what keeps the union destructurable inside the
component; `$props()` must be annotated with the exported type or the constraint
would never reach a call site. The union is safe because no consumer picks
`variant` dynamically: every call site passes a literal. If one ever needs to,
that is the moment to trade the union for a flat type, not a reason to widen it
speculatively.

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

The two non-interactive variants — **`fact`** and **`tag`** — are in §8.23.8.

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
- The **value chip** (§8.27) renders no `aria-pressed` either, and for a
  stronger reason than the expander's: it is a listbox trigger, a combobox or a
  text input, none of which has a pressed state to report. Of the three pill
  treatments in this spec, only `variant="filter"` is ever pressed.
- **`fact` and `tag` render no `aria-pressed` either**, and for the strongest
  reason of the three: they are not controls at all. They render a `<span>`, so
  the question never arises (§8.23.8).
- Colour is never the only carrier of the pressed state — `aria-pressed` carries
  it independently, per v0.2 §7.

## 8.23.7 What Chip does not do

- **No trailing icon, no dismiss "×".** A removable chip is a different control
  (it has two hit targets), and nothing needs one. A *leading* icon exists on
  `fact` alone, added in v0.9.2 — see §8.23.8.
- **No loading or disabled treatment.** A facet that cannot be applied is not
  rendered — the recipe list drops the whole authorship row when the household
  has one member, rather than showing two dead chips.
- **No count badge.** The recipe list ranks its tag chips by frequency and
  deliberately never shows the number; a chip that could show one would invite
  the opposite. (A count on a *tab* is a different thing and is specified —
  v0.10 §8.28.4.)
- **No press-scale.** `.salt-button`'s tap-scale is not inherited. A chip's
  answer to a tap is the fill, which lands on the same frame.

## 8.23.8 The static chips: `fact` and `tag` (v0.9.2)

Two variants that are read, never pressed. Both render **`<span>`**, not
`<button>` — not a button with `disabled`, and not a button with a handler
omitted. A thing that cannot be pressed must not be reachable by Tab, must not
be announced as a control, and must not sit in the same role as the filter chips
it will often share a row with.

**`fact`** — a measured attribute of the thing being read: "Serves 4",
"Prep 40 min", "Cook 6 hr". Tinted ground (`bg-muted`), `border-transparent`,
`text-muted-foreground`, and an optional leading `icon` snippet.

**`tag`** — a word someone attached to the thing rather than measured from it: a
recipe tag. Quiet outline (`border-border`), no background, no icon.

### Why those two names

They name the **role** the chip plays, as `filter` and `expander` do. The
obvious alternative — `static` for the plain one, since it is the plain one —
names the *mechanism* instead, and would have left the axis reading half role,
half implementation, with nothing to call the next static role when it arrives.
Both of these are static; only one of them is a fact.

### Why one axis and not a `tone`

A second axis (`variant` × `tone`, say) would immediately admit combinations
that mean nothing — a tinted expander, an outlined filter — and every one of
them would need a rule saying it is not supported. Four values on one axis, each
naming a role, is the smaller thing. `pressed` stays a separate axis because it
genuinely is orthogonal within `filter`; `fact` and `tag` simply have no rule for
`.salt-chip--on`, exactly as `expander` has none.

### Why the icon is on `fact` only

A fact has a natural glyph — a clock for a duration, people for a serving count —
that carries meaning before the number is read. A tag is an arbitrary word, and
any icon beside it would be a guess. The type enforces this: `icon` is `never` on
every variant but `fact`.

**The style sizes the icon, at 12px, not the caller.** §8.23.4 exists because two
chip sizes shipped from two pages guessing; an icon size left to the call site
would drift the same way inside a year.

### Sizing and the border box

Both static variants restate `inline-flex items-center`, which `.salt-chip` does
**not** carry: a `<button>` is `inline-block` and centres its own text, while a
bare inline `<span>` would drop `py-1` on the floor. The display is not hoisted
into the base rule because that would nudge every filter chip already shipped,
and §8.23.4 permits exactly one pixel of change, already spent.

`fact` keeps `border-transparent` rather than dropping the border: the border box
is what makes a fact, a tag and a filter the same height when they sit in one
row.

### What they do not do

- **No hover, no focus ring, no press.** There is nothing to press.
- **No `onclick`.** Typed `never`. A pill that does something is a `filter`, an
  `expander`, a `Button`, or the value-chip surface (§8.27) — one of those four
  fits, and if none does, amend this spec.
- **No dismiss affordance on `tag`.** Still true, and for the reason §8.23.7
  gives: two hit targets is a different control.

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

---

# 8.27 The value chip

## 8.27.1 Overview

A pill that shows a decision **and lets you change it where it sits**: which
aisle an item belongs to, how it is shopped, the quantity that counts as a lot.
It reads as a chip and it edits like a field.

It is **not a component**. It is a *surface*: one class, `salt-value-chip`,
produced by the exported `valueChipVariants()`, worn by the control that already
owns the interaction — a `SelectTrigger`, a `ComboboxInput`, or a `TextField`'s
frame.

Consumers today: the catalog's review row (issue #872). Under the "Needs review"
filter every row arrives open, and the three decisions the pipeline made are
shown as value chips so a reviewer can correct one without leaving the list.

## 8.27.2 Chip, Button, value chip, or a full field?

Extends the table in §8.23.2.

| Use | Component |
| --- | --- |
| A facet that is on or off, shown alongside its siblings | `Chip` (§8.23) |
| Anything that navigates, submits, opens or destroys | `Button` |
| A **current value** you can read at a glance and change in place, sitting inline in a sentence or a row of its peers | the value-chip **surface**, on the control that owns the interaction (§8.27.4) |
| A value being set as part of a form, with a label, a description and room for an error | `TextField` / `Select` / `Combobox` as they come — no surface |
| A read-only badge that cannot be changed at all | Still neither. A value chip is *editable*; nothing needs a dead pill yet, so add it to this spec before writing it |

The line between the last two is about the reader's posture. A form field is
something you fill in; a value chip is something already decided that you may
disagree with. That is why it carries no label and no error slot: there is
nothing to fill in, and a rejected edit is a `Failure` the page reports its own
way.

## 8.27.3 Why a surface, and not `Chip variant="value"`

Three shapes were considered and two were rejected:

1. **A `value` variant on `Chip`** — rejected. `Chip` renders its own
   `<button type="button">`. A value chip must be the control that opens the
   picker, so a `Chip` would have to *contain* a `SelectTrigger` (a button inside
   a button) or sit next to one and be decorative. Worse, `Chip`'s prop type
   would then offer `variant="value"` to callers with no picker behind it — a
   pill that looks editable and is not.
2. **Both a `Chip` variant and a surface class** — rejected outright. Two
   mechanisms for one look is the drift §8.23.4 exists to end, one level up.
3. **A surface class** — chosen. The pill is applied to whichever element
   already paints the control's border, so the control keeps its own popover
   wiring, focus management, keyboard handling and ARIA, and the surface only
   changes how it looks.

`chipVariants` is deliberately **not** widened and stays unexported. It emits
`.salt-chip`, a `@layer components` rule, which loses the cascade to the
components-layer base class of every control it would be pasted onto
(`.salt-trigger`, `.salt-input`) purely on source order in `salt.css`.
`salt-value-chip` is declared with `@utility` instead, so it lands in the
utilities layer and beats those base classes wherever they happen to sit in the
file. That is a real reason the surface is its own class rather than a member of
the chip's `variant` axis, not a formatting preference.

## 8.27.4 How it is worn

The surface always goes on the element that paints the border, merged last via
`cn()` (v0.2 §2.3) — every one of these controls already does that with its
`class` prop.

A `Select` — the trigger *is* the button, so the surface goes straight on it and
the chevron stays inside the one hit target:

```svelte
<div class="w-28">
  <Select value={behavior} onValueChange={save}>
    <SelectTrigger class={valueChipVariants()} aria-label="How this is shopped">
      {label}
    </SelectTrigger>
    <SelectContent>…</SelectContent>
  </Select>
</div>
```

A `Combobox` — the surface goes on `ComboboxInput`, and `ComboboxField` /
`ComboboxTrigger` are **dropped**. `ComboboxInput` already registers itself as
the popup's anchor when no field wraps it (v0.4 §5.1), and a chevron button
inside a pill this size would be a second hit target inside a 26px control:

```svelte
<div class="w-40">
  <Combobox items={aisleItems} value={aisleId} onValueChange={save} restrict>
    <ComboboxInput class={valueChipVariants()} aria-label="Aisle" />
    <ComboboxContent>…</ComboboxContent>
  </Combobox>
</div>
```

**The surface sets no width.** The controls keep the `w-full` their own base
classes give them and the caller sizes the wrapper, exactly as the record
editor's unit select already does. A `w-auto` inside the utility would collide
with any width utility the caller passes on the same element, and which of two
utilities wins is decided by Tailwind's internal sort order rather than by
anything a reader of the markup can see.

## 8.27.5 The threshold is an input, and that is the point

The three decisions are not three pickers. Aisle is a searchable `Combobox`,
behaviour is a three-option `Select`, and the threshold is **a number typed into
a text input** beside a unit `Select`. An input can never be a `<button>`, so any
"a chip is a button that opens something" formulation would have left the third
decision uncovered. A class covers all three without a special case — this is the
strongest single argument for the surface over a component.

Reaching a `TextField`'s border needs one addition: `TextField` (v0.2 §8.2) gains
a **`frameClass`** prop, merged last via `cn()` onto the frame `<div>`. Its
`class` prop lands on the outer stack that holds label, frame, description and
error — styling that stack pills the wrong element. This is the same shape of
problem as `triggerTestId` in §8.25.5: the thing that needs naming is one level
in from where `...rest` lands.

`frameClass` exists for this one purpose and is not a general styling hatch.
Anything that wants to change how a field frame *looks* outside this surface
earns a variant on `textFieldFrameVariants`, not a class from the page.

```svelte
<TextField
  class="w-20"
  frameClass={valueChipVariants()}
  inputmode="numeric"
  aria-label="Quantity threshold"
  value={draft}
  onValueChange={(v) => (draft = v)}
  onblur={save}
/>
```

A value chip carries no visible label, so every one of these needs an
`aria-label` — the field's own `label` prop would render text the pill has no
room for.

## 8.27.6 Accessibility

- The value chip **never carries `aria-pressed`**, in any of its forms. It is
  not a toggle and has no on/off state: it is a listbox trigger, a combobox, or
  a text input, and each already announces itself correctly. Extending §8.23.6:
  of the three pill treatments in this spec, only `Chip variant="filter"` is
  ever pressed.
- The control keeps every attribute it had unstyled — `aria-haspopup`,
  `aria-expanded`, `aria-controls`, `role="combobox"`, `aria-invalid`. The
  surface adds no ARIA of its own and removes none, which is exactly what it
  buys by not being a component.
- Because the pill shows no label, the accessible name comes from the caller's
  `aria-label`. A value chip with no accessible name is a spec violation.
- **The surface carries its own focus ring**, restating the base
  `:focus-visible` rule rather than inheriting it. `.salt-input--combobox` sets
  `outline-none` and leans on `ComboboxField`'s `focus-within` ring, and a value
  chip drops the field (§8.27.4) — without the restatement a keyboard user
  tabbing onto the aisle chip would see nothing. On the select trigger and the
  text field it changes nothing: it is the ring they already had.
- Colour is never the only carrier of state — there is no state to carry
  (v0.2 §7).

## 8.27.7 It is a pill, which amends v0.2 §2.3

v0.2 §2.3 says field frames take the base `rounded` (4px) and forbids a fourth
radius for those surfaces without amending the rule. **This amends it, for this
surface only:** a value chip is `rounded-full`, because round-ended is what makes
a control read as a chip rather than as a form field the page forgot to lay out.
The radius is the whole message. Field frames everywhere else stay on `rounded`.

The rest of the treatment is `.salt-chip`'s, restated rather than inherited (see
§8.27.3 for why it cannot be inherited): `px-3 py-1 text-xs font-medium`, a
one-pixel `border-border`, `bg-background`, `hover:bg-muted`. Two deliberate
differences from `Chip`:

- `text-foreground`, not `text-muted-foreground`. A filter chip's label is a
  category name; a value chip's label is *the answer*, and the answer is not
  secondary text.
- `h-auto`, defeating the `h-9` / `h-10` its base class sets, so the pill's
  height comes from `py-1` and it matches the chips around it.

## 8.27.8 What the value chip does not do

- **No pressed, hidden, loading or error treatment.** A rejected write is
  reported by the page (Rule 10 gives it a `Failure`, not an exception); a pill
  that could turn red would be a second, quieter error channel next to the one
  the page already has.
- **No sizes.** One size, for the reason §8.23.4 gives: the row it sits in is a
  row of chips, and a second size re-opens the drift.
- **No component, no wrapper, no `ValueChip.svelte`.** If a future consumer finds
  itself repeating a *composition* (say, the number-plus-unit pair below), that
  composition earns a component and this surface stays what it is.
- **No layout.** `ChipGroup` (§8.24) is for a row of `Chip`s; a row of value
  chips is `flex flex-wrap items-center gap-2` owned by the page, because the
  page is also deciding widths (§8.27.4) and interleaving units with their
  amounts.
