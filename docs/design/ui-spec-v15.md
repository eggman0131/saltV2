# Salt 2.0 — UI Primitives Specification (v0.15)

**Status:** Planning  
**Scope:** `@salt/ui-components` — `AppShell` collapsible `SideNav`  
**Audience:** AI code-generation agents + human contributors

> Rule: If anything is missing or ambiguous → STOP → extend this spec → regenerate.  
> No invention beyond what is written here.

This document extends **v0.2** through **v0.14**.  
All global rules, architecture, naming, styling, and testing conventions from v0.2 remain in force, as do v0.4's layout-component sections (§13, §16, §17) and v0.5 §2 (`AppShell` full-viewport routes). This spec adds one prop to `AppShell`, one control to `TopBar` and one attribute to `SideNav`; it changes the behaviour of none of them when that prop is not passed.

---

## 0. v0.15 Scope

v0.15 introduces:

- **`AppShell` collapsible `SideNav`** — an opt-in `navCollapsed` prop that removes the desktop side navigation and gives its width to the page, plus the `TopBar` control that toggles it (§1)

Nothing in v0.15 changes the default behaviour of any existing component. `navCollapsed` defaults to `false`, and every shell that does not pass it renders exactly as it did under v0.14. The `chrome` prop (v0.5 §2.3) is untouched, and its semantics are unchanged.

---

# 1. AppShell — Collapsible SideNav

## 1.1 Overview

From `lg` (1024px) up, `AppShell` renders a 256px `SideNav` beside `<main>`. On a
laptop that column is the app's navigation; it is also a quarter of a 1024px
window, and on a page the user is reading or editing at length it is a quarter of
the window spent on something they are not using.

`navCollapsed` removes it. `<main>` is a `flex-1` sibling in the same flex row, so
the freed 256px goes to the page automatically — an ordinary page takes all of it,
a two-column page divides it by the fractions that column layout already has. No
page needs to know the nav collapsed, and no page is given the chance to care.

The state is **in-memory**, held by `AppShell` for the life of the page. `AppShell`
is mounted once for the app's whole life, so the choice survives navigation —
including in and out of a full-viewport route — and a reload reopens the
navigation. It is deliberately not persisted: see §1.8.

## 1.2 The mechanism: not rendered, never painted over

**Collapsed means `SideNav` is not rendered at all.** This is the same argument
v0.5 §2.3 makes for `chrome={false}`, against the same defect (issue #641): a nav
that is merely `hidden`, `aria-hidden`, `inert`, `w-0` or covered stays in the
DOM, stays in the tab order and stays in the accessibility tree. A keyboard user
then tabs into navigation they cannot see, and a screen-reader user browses
destinations that are not on screen. Not rendering removes it from both the tab
order and the accessibility tree in one move, which is why §1.7 asserts on
**absence from the DOM** rather than on an attribute.

A consequence to accept rather than work around: **there is no open/close
animation.** An element cannot be transitioned while it is being unmounted
without machinery whose only purpose is to keep it on screen slightly longer —
and that machinery reintroduces exactly the focusable-while-invisible window this
design exists to avoid. Instant is correct here, and is what `chrome={false}`
already does.

## 1.3 Props and the nav's id

```ts
// AppShell
navCollapsed?: boolean; // bindable, default false
```

`navCollapsed={true}` makes `AppShell` **not render** `SideNav`. It changes
nothing else: the root stays `flex h-dvh flex-col`, the nav/main row stays
`flex flex-1 overflow-hidden`, `<main>` stays `flex-1 overflow-y-auto`, and
`<main>`'s BottomNav height reservation is keyed on `chrome` alone — the
`BottomNav` is a mobile control and the collapse is a desktop one, so the
reservation is not the collapse's business (v0.4 §13.3 is unchanged).

The prop is `$bindable(false)` and follows v0.2 §3.6's canonical
controlled/uncontrolled wiring. Uncontrolled is the intended use and the reason
the shape was chosen: `apps/web-pwa` passes nothing, and `AppShell` owns the
state. A consumer that later needs to own it — to persist it, say — binds to it
with no other change anywhere.

`SideNav` carries a **stable `id`** on its `<nav>`, exported as `SIDE_NAV_ID`
from `SideNav.svelte`'s module block. It exists for one reason: the control's
`aria-controls` must name the element it controls. It is declared beside the
element that carries it, and read by `TopBar` from there, so the two cannot
drift. It is not a styling hook and nothing may select on it for layout.

## 1.4 The control

The toggle lives in `TopBar`, as its **leading** child, before the title.
`TopBar` is rendered whenever the shell has chrome at all, so the way back is
never lost and never moves.

```ts
// TopBar
navCollapsed?: boolean;
onToggleNav?: (() => void) | undefined;
```

- The control renders **only when `onToggleNav` is supplied**. A `TopBar` used on
  its own — a story, a fixture — has no `SideNav` to collapse and shows no
  control.
- It is the `Button` primitive, `variant="ghost"`, `size="sm"`, carrying
  `salt-focus-ring` through `Button` as every primitive does (v0.2 §4.2).
- It is classed `hidden lg:inline-flex`. **Below `lg` there is no `SideNav`**, so
  there is nothing to collapse and the control does not exist for a user at that
  width. This is the `lg` nav seam (`SideNav`'s own `hidden … lg:flex`), and it
  is the only seam this feature touches — the `split` two-pane seam is a separate
  viewport query at 700px and must not be changed, read, or reasoned about here.
- Its glyph states which way it goes: `panel-left-close` while the nav is open,
  `panel-left-open` while it is collapsed, imported directly from
  `@lucide/svelte/icons/…` (icons imported by name inside `@salt/ui-components`
  are not registered — see `iconRegistry.ts`).
- Its **accessible name says what pressing it does**, not what it is:
  "Hide navigation" while open, "Show navigation" while collapsed.
- It carries `aria-expanded` tracking the nav's state (`true` open, `false`
  collapsed) and `aria-controls` naming `SIDE_NAV_ID`.

`aria-controls` names an element that is absent while collapsed, and that is
correct for a disclosure whose content is unmounted: `aria-expanded="false"` is
what tells a user agent the referenced region is not currently present. Do not
"fix" it by keeping an empty `<nav>` rendered — that is §1.2's defect returning
through the back door.

## 1.5 Interaction with `chrome`

The two gates compose, and `chrome` dominates:

| `chrome` | `navCollapsed` | `TopBar` | `SideNav` | toggle control | `BottomNav` |
| -------- | -------------- | -------- | --------- | -------------- | ----------- |
| `true`   | `false`        | rendered | rendered  | rendered       | rendered    |
| `true`   | `true`         | rendered | —         | rendered       | rendered    |
| `false`  | either         | —        | —         | —              | —           |

A full-viewport route (v0.5 §2) renders no chrome at all, so it renders no
control and there is nothing to toggle. `navCollapsed` is not cleared on the way
in or out: `AppShell` stays mounted across the route change, so a user who
collapsed the nav, cooked, and came back finds it still collapsed. That is the
intent, not an accident of implementation.

## 1.6 What the page does with the space

Nothing, in every case, and that is the design:

- An ordinary single-column page takes the whole 256px, because `<main>` is
  `flex-1`.
- A two-column page divides it by the fractions its own grid already declares —
  an equal-halves layout splits it evenly, and a `lg:grid-cols-[2fr_1fr]` layout
  splits it 2:1. A CSS grid distributes new width by its existing fractions on
  its own, so **no page needs code for this**, and none may add any.
- Collapsing the nav **cannot** change how many columns a page has. The `split`
  seam is a viewport query; the viewport does not move when the nav does. A page
  that is one column stays one column, wider.

## 1.7 Testing requirements

- A default `AppShell` renders the `SideNav` and the toggle control.
- `navCollapsed` renders **no `SideNav`**, and leaves **none of its links**
  reachable — assert on absence from the DOM and on the drop in the shell's
  focusable count, not on `inert`, `hidden` or `aria-hidden`. A test that only
  asserts the element is gone passes over a `w-0` nav; the focusable count is
  what makes the claim in §1.2 mechanical.
- `chrome={false}` renders no toggle control (and, per v0.5 §2.5, nothing
  focusable at all).
- The control's `aria-expanded` tracks the state, and its `aria-controls` names
  an element that exists while expanded.
- Pressing the control toggles the shell with no binding at the call site —
  the uncontrolled path is the one the app uses.
- End-to-end, at a viewport above `lg`: the page's content box is measurably
  ~256px wider collapsed than expanded, toggling back restores it, and at a
  phone viewport the control is not present.

## 1.8 Forbidden

- **Do not persist the state.** Browser storage is forbidden outright (CLAUDE.md
  Rule 3, and a nav preference does not clear the "pre-auth or page-load
  mechanics" bar for a fourth key). A field on the member document was considered
  and rejected on cost, not on principle; if it is ever revisited, the
  `$bindable` prop in §1.3 is the seam to hang it on, with no redesign.
- **Do not hide the nav instead of unmounting it** — no `hidden`, `aria-hidden`,
  `inert`, `w-0`, `-translate-x-full`, or a page painting over it. See §1.2.
- **Do not add an open/close transition.** See §1.2.
- **Do not introduce a `--salt-layout-side-nav-width` token.** The width is read
  by nobody: `<main>` absorbs it as a `flex-1` sibling. One consumer is not a
  token, and the bottom-nav-height token exists because four separate places had
  to agree on that number and drifted (#930). This one has one place.
- **Do not render an icon-only rail in place of the nav.** Collapsed is
  collapsed; a rail returns less space and needs a tooltip and an accessible name
  on every item to stay usable.
- **Do not render the control below `lg`**, and do not give it a mobile
  equivalent. Below `lg` the `BottomNav` is the navigation and there is nothing
  to collapse.
- **Do not let a page read the collapsed state**, through a store, a context or a
  prop. §1.6 is the whole contract: the page gets width, and is told nothing.
- **Do not touch the `split` seam** — neither `@custom-variant split` nor its
  forced JS twin — to account for the nav. They are two spellings of one viewport
  query and a third spelling is a test failure.
