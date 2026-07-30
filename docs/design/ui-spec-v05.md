# Salt 2.0 — UI Primitives Specification (v0.5)

**Status:** Planning  
**Scope:** `@salt/ui-components` — `ListPage` fill mode  
**Audience:** AI code-generation agents + human contributors

> Rule: If anything is missing or ambiguous → STOP → extend this spec → regenerate.  
> No invention beyond what is written here.

This document extends **v0.2**, **v0.3** and **v0.4**.  
All global rules, architecture, naming, styling, and testing conventions from v0.2 remain in force, as do v0.4's layout-component sections (§13, §16, §17) and its `ListPage` Selection Mode contract (§9).

---

## 0. v0.5 Scope

v0.5 introduces:

- **`ListPage` fill mode** — an opt-in `fill` prop that makes a page occupy the app shell's content area rather than grow with its content, handing the leftover height to `children` so the page can own its own scrolling surface (§1)

Nothing in v0.5 changes the default behaviour of any existing component. `fill` defaults to `false`; every page that does not pass it renders exactly as it did under v0.4.

---

# 1. ListPage — Fill mode

## 1.1 Overview

By default a `ListPage` grows with its content and `AppShell`'s `<main>` scrolls it. That is correct for essentially every list in the app and remains the default.

A small number of pages instead need to **own their own scrolling surface** — a gesture-driven deck, a virtualised list, a pane that must not move while something inside it does. Such a page needs a definite height to size that surface against, and it must not simultaneously be scrolled by an ancestor. `fill` provides both.

Precedent: the meal planner's week view (issue #639), which pages between days with the shared gesture deck (`apps/web-pwa/src/lib/deck.svelte.ts`) and therefore cannot be a natural-height page inside a scrolling `<main>`.

## 1.2 The height chain

`AppShell` (§13) renders:

```
div.flex.h-dvh.flex-col
  TopBar
  div.flex.flex-1.overflow-hidden
    SideNav
    main.flex-1.overflow-y-auto.pb-[calc(3.5rem+env(safe-area-inset-bottom))].lg:pb-0
```

`<main>` therefore already has a **definite, bounded height** — it is a `flex-1` child of a fixed-height column. What was missing is that `ListPage` passed no height down to its children.

Under `fill`:

- The root `<section>` gains `h-full min-h-0`. `h-full` resolves against `<main>`'s definite height (and, because `<main>` carries the bottom-nav padding, resolves to the space *above* the nav automatically). `min-h-0` allows the section to shrink inside the flex column rather than being floored at its intrinsic content height.
- The content wrapper gains `flex flex-1 flex-col` alongside its existing `min-h-0`, so it takes the height left over after the header and toolbar and passes it to `children`.

**`AppShell` is not modified, and must not be.** `<main>` is `overflow-y-auto`, which scrolls only *on overflow*. A page that exactly fills it therefore leaves it with nothing to scroll. The two mechanisms do not have to be coordinated because they never overlap.

## 1.3 Props

- `fill?: boolean` (default `false`). When `true`, the page fills the shell's content area and `children` receives the remaining height.

`fill` composes with every other `ListPage` prop, including selection mode. When `fill` and the contextual bottom action bar are both active, `pb-24` still applies — the fixed bar overlays the filled page exactly as it overlays a scrolling one.

Conditional classes are composed through `cn` (tailwind-merge), so a caller's own `class` continues to merge and override normally — the same mechanism as the existing `showActionBar && 'pb-24'`.

## 1.4 Consuming-page contract

A page passing `fill` **must** give its scrolling child a definite height from the chain — typically `min-h-0 flex-1` on the child that clips, with `overflow-hidden` if it owns the gesture itself. It must not reintroduce a second scroller inside a filled page unless that is the entire point of filling.

```svelte
<ListPage title="Meal plan" fill class="p-4 sm:p-6">
  {#snippet children()}
    <!-- header/nav chrome at natural height -->
    <div class="min-h-0 flex-1 overflow-hidden">
      <!-- the page's own scrolling / gesture surface -->
    </div>
  {/snippet}
</ListPage>
```

## 1.5 When NOT to use it

`fill` is for a page that owns a scrolling surface. It is **not** a way to make a page "fit on one screen", and it is not a fix for a page whose content is slightly too tall. An ordinary list that simply has many rows should keep the default and let `<main>` scroll it — that is the behaviour with native momentum, a real scrollbar, find-in-page, and correct zoom reflow, and it should be given up only for a specific interaction that requires it.

## 1.6 Testing requirements

- A default (`fill` unset) `ListPage` renders with no height classes on its root — proving existing pages are untouched.
- A `fill` `ListPage` renders `h-full` and `min-h-0` on its root and `flex-1` on its content wrapper.
- `fill` composes with `class`: a caller's padding still applies and is not dropped by `cn`.

## 1.7 Forbidden

- Do not set `overflow` on `AppShell`'s `<main>`, or otherwise modify `AppShell`, to make a filled page work. The overflow-only-on-overflow behaviour is the mechanism; overriding it couples the shell to one page.
- Do not compute a pixel height in a consuming page (`calc(100dvh - …)`, measuring `TopBar`, reading `clientHeight` to set a style). That hardcodes shell chrome into a page and breaks when the chrome changes; use `fill` and the height chain.
- Do not use `fill` merely to suppress page scrolling, or to make content fit without addressing why it overflows.
- Do not nest a second `fill` `ListPage` inside a filled one.
