# Salt 2.0 — UI Primitives Specification (v0.10)

**Status:** Planning  
**Scope:** `@salt/ui-components` — `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`  
**Audience:** AI code-generation agents + human contributors

> Rule: If anything is missing or ambiguous → STOP → extend this spec → regenerate.  
> No invention beyond what is written here.

This document extends **v0.2**, **v0.3**, **v0.4**, **v0.5**, **v0.6**, **v0.7**, **v0.8** and **v0.9**.  
All global rules, architecture, naming, styling, and testing conventions from v0.2 remain in force.

---

## 0. v0.10 Scope

v0.10 introduces one component, in four parts:

- **`Tabs`** — the root, which owns which panel is showing (§8.28)
- **`TabsList`** — the strip, a `role="tablist"` (§8.29.2)
- **`TabsTrigger`** — one tab, optionally carrying a count (§8.29.3)
- **`TabsContent`** — one panel, whose content belongs entirely to the page (§8.29.4)

Unlike v0.9, this is **not** a promotion. Nothing in `apps/web-pwa` renders a tab
strip today; there is no hand-roll to fold in, and therefore no existing pixel
this spec is allowed to move. It is a new capability, added ahead of the
consumer that wants it (the recipe detail redraw, issue #878) so that consumer
never has a reason to hand-roll a roving-focus widget in a page.

v0.10 changes the behaviour of no existing component. The `Chip` amendment that
lands alongside it — the two non-interactive variants — is **not** here: a
change to `Chip` belongs in `Chip`'s own spec, so it is v0.9 §8.23.8 and the
amended §8.23.2 table row. The two are related only by the page that will use
both.

---

# 8.28 Tabs

## 8.28.1 Overview

One region of a page, two or more mutually exclusive views of it, and a strip of
words at the top that says which you are looking at. Exactly one panel is
present at a time; the others are `hidden`, out of the accessibility tree and
out of the tab order.

The whole widget is a wrapper over **bits-ui**'s `tabs`, for the same reason
`Switch`, `Checkbox`, `Progress`, `Dialog`, `Popover`, `Sheet` and `Tooltip` are
wrappers: the hard part of a tab strip is not its appearance, it is the roving
tabindex, the arrow/Home/End key handling, the id minting that ties
`aria-controls` to `aria-labelledby` in both directions, and the focus that must
survive a re-render. All of that is solved, tested and maintained upstream.
Hand-rolling it here would be reinvention, and the two primitives in this
package that *do* hand-roll a headless layer (`RadioGroup`, `Select`) predate the
decision rather than justify it.

What Salt owns is the vocabulary — the four component names, the count, and the
rule that the selected value belongs to the page — plus the styling.

Consumer intended: the recipe detail page, switching Ingredients and Method.

## 8.28.2 Tabs or something else?

| Use | Component |
| --- | --- |
| Two or more views of **the same region**, one at a time, all of comparable weight | `Tabs` |
| Sections that are all part of one document and could all be read at once | `CollapsibleSection` (v0.9 §8.25) — several may be open together; tabs never are |
| A row that **narrows a list** rather than replacing it | `Chip` + `ChipGroup` (v0.9 §8.23, §8.24) |
| Two views of the whole **page**, with their own URLs | Routes. A tab strip that changes the address bar is a nav bar wearing the wrong ARIA |
| A single detail that opens beneath its row | `DisclosureTrigger` (v0.9 §8.26) |

The distinction that actually decides it: **a tab strip claims that its panels
are alternatives.** If a reader could reasonably want two of them visible
together, they are not tabs — they are sections, and hiding one behind the other
costs them something. Ingredients and Method are alternatives on a phone (there
is one screen and one thing you are doing) and would not be on a wall-sized
display; that is a judgement the consuming page makes once, not a prop.

## 8.28.3 Anatomy — and who owns the panel

```svelte
<Tabs bind:value={tab}>
  <TabsList ariaLabel="Recipe">
    <TabsTrigger value="ingredients" count={19}>Ingredients</TabsTrigger>
    <TabsTrigger value="method" count={14}>Method</TabsTrigger>
  </TabsList>

  <TabsContent value="ingredients">…the page's own markup…</TabsContent>
  <TabsContent value="method">…the page's own markup…</TabsContent>
</Tabs>
```

Four parts, one `index.ts`, following `Dialog` and `Sheet` (v0.3 §5). The
`value` string is the only thing tying a trigger to its panel: the ids that
carry `aria-controls` and `aria-labelledby` are minted internally and are not a
consumer's business.

**`TabsContent` renders whatever the page puts in it and styles none of it.** It
contributes exactly one thing of its own — `pt-4`, the gap between the strip and
the content it belongs to. Everything else is the page's markup, because the
panels of a recipe are an ingredient list and a method list, and a primitive that
had opinions about either would be two components pretending to be one.

**The panels stay mounted.** Unlike `CollapsibleSection` (v0.9 §8.25.3), which
removes its children, an unselected `TabsContent` is rendered and marked
`hidden`. Both satisfy the same rule from v0.5 §2 — a hidden panel is out of the
accessibility tree and holds no focusable descendants — but tabs are switched
back and forth as a matter of course, and unmounting would throw away scroll
position, form state and any measurement the page had taken. A collapse is a
decision to put something away; a tab is a glance sideways.

## 8.28.4 Selection, keyboard, and the count

**Roving tabindex.** Exactly one trigger is in the page's tab order at a time —
the selected one. Tab reaches the strip once and then moves on to the panel; the
arrows move between tabs. `Home` and `End` jump to the ends, and the arrows wrap
at them.

**Activation is automatic**: moving to a tab with an arrow key selects it, rather
than requiring `Enter`. This is the WAI-ARIA default and the right one here,
because Salt's panels are already-rendered markup — nothing is fetched, nothing
is computed, and the manual mode exists to protect readers from tabs that are
expensive to open. There is no `activationMode` prop; a panel expensive enough to
need one earns an amendment to this section first.

**The count is a prop, not something the caller writes into the label.**
`<TabsTrigger count={19}>Ingredients</TabsTrigger>` renders the number inside the
button, so it joins the tab's accessible name — the tab announces as
"Ingredients 19", which is what the tab *is*. Making it a prop rather than
interpolated text is what lets the style decide the number's size, weight and
colour once, and keeps it from being a second thing the page has to remember to
mute. `0` is a real count and renders; only an omitted `count` renders nothing.

The count is styled as a companion, never a competitor: one step smaller, normal
weight, and `tabular-nums` so a strip does not reflow as 9 becomes 10.

## 8.28.5 The host owns the selected value

`value` is `$bindable`, and `onValueChange` fires on every change. A page may
run `Tabs` uncontrolled — pass `defaultValue` and never look again — but the
controlled path is the one this spec is designed around, because **the page must
be able to move the selection itself**.

That is not hypothetical. On the recipe page the chat drawer can answer a
question by pointing at a step, and the step may be sitting in the panel that is
currently hidden; scrolling to it is meaningless unless the panel comes forward
first. A tab strip that only ever selected itself would make that impossible and
push the page into faking it with a hidden radio group.

`defaultValue` is read **once**, untracked, exactly as `Sheet`'s `defaultOpen`
is (v0.3 §5). A later change to it must not yank the panel out from under
someone mid-read; a page that wants to move the selection has `value` for that.

`value` is written back **before** `onValueChange` runs, so a host that reads it
inside the callback sees the tab it has arrived at, not the one it left.

## 8.28.6 Accessibility

- The list is always a `role="tablist"`, its triggers `role="tab"` with
  `aria-selected` on every one of them, and each panel a `role="tabpanel"`
  labelled by its trigger. All of it comes from bits-ui, and none of it is
  overridable — see §8.29.5.
- **`ariaLabel` on `TabsList` is optional but strongly preferred.** Unlike
  `ChipGroup` (v0.9 §8.24.4), there is no unnamed fallback available: the
  `role="tablist"` is intrinsic to the widget, so omitting the name leaves a
  named boundary with nothing to say rather than no boundary at all. Every new
  consumer passes one.
- The unselected panels carry `hidden`. Nothing inside them is focusable and
  nothing is announced — the same obligation v0.5 §2 places on covered
  navigation chrome, met here by the attribute rather than by unmounting.
- The selected panel carries `tabindex="0"`, so Tab moves from the strip into
  the content. That is deliberate and comes from the ARIA pattern: with a roving
  tabindex the strip is one stop, and the panel needs to be the next one or a
  keyboard reader would have no way to reach content that contains no controls.
- Colour is never the only carrier of selection — `aria-selected` carries it
  independently, per v0.2 §7.

## 8.28.7 What Tabs does not do

- **No routing.** A tab does not change the URL and does not read it. If two
  views deserve their own addresses they are routes, not tabs (§8.28.2); if a
  page wants a tab reflected in the URL it can do that itself with `value` and
  `onValueChange`, which is a page concern and stays one.
- **No lazy panels, and no unmounting.** See §8.28.3. A panel expensive enough
  to want either is a reason to amend this spec, not to add a prop quietly.
- **No overflow handling — no scrolling strip, no "more" menu.** Salt's tab
  strips are two or three words wide. A strip that needed to overflow would be a
  sign the page has too many alternatives, and the answer is fewer tabs.
- **No variants, no sizes.** There is one tab strip. v0.9 §8.23.4 records what
  happens when a component ships two of something because two pages guessed
  differently; this one starts with the rule already in place.
- **No icons on a tab.** A tab is a word. An icon beside it is either
  redundant with the word or replacing it, and a replaced word is a tab you
  cannot name in a conversation.
- **No vertical orientation.** bits-ui supports it; nothing here needs it, and
  the styling (a bottom hairline the active tab interrupts) is horizontal by
  construction. Wiring the prop through without the styling would ship a broken
  option.
- **No disabled tab.** A view that cannot be opened should not be offered.

---

# 8.29 The parts

## 8.29.1 `Tabs`

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `value` | `string` | — | The selected tab. `$bindable` — see §8.28.5 |
| `defaultValue` | `string` | `''` | The initial selection when `value` is not supplied. Read once, untracked |
| `onValueChange` | `(value: string) => void` | — | Fires on every change, from any cause |
| `children` | `Snippet` | — | The `TabsList`, then the `TabsContent` panels |
| `class` | `string` | — | Merged last via `cn()` (v0.2 §2.3) |

## 8.29.2 `TabsList`

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `ariaLabel` | `string \| undefined` | — | Names the strip. §8.28.6. Explicitly `\| undefined` so a conditional name can be passed straight through under `exactOptionalPropertyTypes`, matching `ChipGroupProps['ariaLabel']` |
| `children` | `Snippet` | — | The `TabsTrigger`s |
| `class` | `string` | — | Merged last via `cn()` |

## 8.29.3 `TabsTrigger`

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `value` | `string` | — | **Required.** Ties this tab to the panel with the same value |
| `count` | `number \| undefined` | — | Rendered after the label, inside the button, and part of the accessible name. `0` renders; omitted renders nothing. §8.28.4 |
| `children` | `Snippet` | — | The tab's label. Text only |
| `class` | `string` | — | Merged last via `cn()` |

## 8.29.4 `TabsContent`

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `value` | `string` | — | **Required.** Ties this panel to the trigger with the same value |
| `children` | `Snippet` | — | The page's own markup (§8.28.3) |
| `class` | `string` | — | Merged last via `cn()` |

## 8.29.5 The passthrough is `data-*`, and only `data-*`

All four parts spread `...rest` onto the element they render, and `rest` is
typed as `data-*` attributes alone — deliberately narrower than the
`HTMLAttributes` passthrough every other primitive in this package offers.

Two reasons, and the first is the real one:

- **Everything else on these elements is the widget.** `role`, `id`,
  `aria-selected`, `aria-controls`, `aria-labelledby`, `tabindex` and `hidden`
  are computed and kept in agreement by bits-ui. Wiring them together *is* the
  primitive, and a wide passthrough would hand a page the means to overwrite
  precisely the attributes it must not touch. Compare v0.9 §8.23.3, where the
  wide passthrough is right because a `Chip` is a button with a class on it and
  owns almost nothing.
- bits-ui's own prop types are `Without<>` intersections, and passing a full
  `HTMLAttributes` through one does not typecheck under
  `exactOptionalPropertyTypes` — TypeScript reports a union "too complex to
  represent". The narrow type is not a workaround for that; it is the honest
  shape, and the compiler agreeing is a bonus.

`data-testid` is what consumers actually need from a passthrough — the recipe
page's tabs will be clicked by e2e — so `data-testid` is what rides.

A part that genuinely needs another attribute gets a named prop, as
`TabsList.ariaLabel` did.
