# Salt 2.0 — UI Primitives Specification (v0.7)

**Status:** Planning  
**Scope:** `@salt/ui-components` — `DetailPage` fill mode  
**Audience:** AI code-generation agents + human contributors

> Rule: If anything is missing or ambiguous → STOP → extend this spec → regenerate.  
> No invention beyond what is written here.

This document extends **v0.2**, **v0.3**, **v0.4**, **v0.5** and **v0.6**.  
All global rules, architecture, naming, styling, and testing conventions from v0.2 remain in force, as does the whole of v0.5 §1 (`ListPage` fill mode) — this section **reuses** its height chain rather than restating or amending it.

---

## 0. v0.7 Scope

v0.7 introduces:

- **`DetailPage` fill mode** — an opt-in `fill` prop that makes a detail page occupy the app shell's content area rather than grow with its content, handing the leftover height to `children` so the page's body can own its own scrolling (§1)

Nothing in v0.7 changes the default behaviour of any existing component. `fill` defaults to `false`; every detail page that does not pass it renders exactly as it did under v0.2 §9.3.

---

# 1. DetailPage — Fill mode

## 1.1 Overview

By default a `DetailPage` grows with its content and `AppShell`'s `<main>` scrolls it. That is correct for essentially every detail page in the app and remains the default.

A detail page whose body lays out **two panes side by side that must scroll independently** cannot work that way. With one ancestor scroller, moving either pane moves both, and anything docked to the bottom of the shorter pane sits below the scrollport floor until the *other* pane has been scrolled far enough to bring it up. `fill` gives the page a definite height to size those panes against, and stops the ancestor scrolling it.

Precedent: the recipe view's docked chef chat (issue #737), where the recipe and the conversation share the page at `split:` sizes and the chat's composer must be reachable without scrolling the recipe.

`ListPage` gained the same mechanism in v0.5 §1 for a different reason (a gesture deck). The mechanism is identical and deliberately not re-specified here.

## 1.2 The height chain

**As v0.5 §1.2, unchanged.** `AppShell`'s `<main>` already has a definite, bounded height; what was missing is that `DetailPage` passed no height down to its children.

Under `fill`:

- The root `<section>` gains `h-full min-h-0`.
- The children wrapper gains `flex min-h-0 flex-1 flex-col` alongside its existing `min-w-0`, so it takes the height left over after the header and passes it to `children`.

`min-h-0` on the wrapper is load-bearing and is **not** optional alongside `flex-1`: a column flex item's `min-height` is `auto`, which floors it at its content's height. Without it the wrapper reports `flex-1` and still renders at its natural height, overflowing the filled section — the page looks unfilled while carrying every fill class. (`ListPage`'s wrapper already carried `min-h-0` for unrelated reasons, so v0.5 §1.2 did not have to say this.)

**`AppShell` is not modified, and must not be.** See v0.5 §1.2 for why the two mechanisms never need to be coordinated.

## 1.3 Props

- `fill?: boolean` (default `false`). When `true`, the page fills the shell's content area and `children` receives the remaining height.

Conditional classes are composed through `cn` (tailwind-merge), so a caller's own `class` continues to merge and override normally — the same mechanism as `ListPage`'s.

Under `fill` the `DetailPage` header — back button, title, subtitle and the actions row — stays above the body while the body scrolls beneath it. This falls out of the height chain and is not separately configurable.

## 1.4 Consuming-page contract

A page passing `fill` **must** give its scrolling child a definite height from the chain — `min-h-0 flex-1` on the child that scrolls, plus `overflow-y-auto` on whichever element owns the scrolling.

```svelte
<DetailPage title="Weeknight pasta" fill>
  {#snippet children()}
    <div class="grid min-h-0 flex-1 grid-cols-2 gap-10">
      <div class="min-h-0 overflow-y-auto"><!-- left pane scrolls itself --></div>
      <div class="flex min-h-0 flex-col"><!-- right pane, its own inner scroller --></div>
    </div>
  {/snippet}
</DetailPage>
```

A page that fills only at some breakpoints passes `fill` from the **same** gate that drives its responsive classes — one gate, not two that can disagree.

## 1.5 `fill` and `metadata` are mutually exclusive

A page must not pass both. The `metadata` aside is `lg:sticky lg:top-4`, which presupposes the ancestor scroller `fill` removes; a tall aside inside a filled page would clip with no way to reach the rest of it.

This is **declared, not enforced at runtime** — no current consumer wants both, and adding runtime enforcement for a combination nothing asks for is not worth the code. Reconciling them (giving the aside its own scroller under `fill`) is deferred until something needs it.

## 1.6 When NOT to use it

`fill` is for a detail page whose body owns a scrolling surface. It is **not** a way to make a page "fit on one screen", and it is not a fix for a page whose content is slightly too tall. An ordinary detail page that simply has a lot of content should keep the default and let `<main>` scroll it — that is the behaviour with native momentum, a real scrollbar, find-in-page, and correct zoom reflow.

## 1.7 Testing requirements

- A default (`fill` unset) `DetailPage` renders with no height classes on its root — proving existing pages are untouched.
- A `fill` `DetailPage` renders `h-full` and `min-h-0` on its root, and `flex-1` **and `min-h-0`** on its content wrapper — the second is what stops the wrapper being floored at its content height.
- `fill` composes with `class`: a caller's padding still applies and is not dropped by `cn`.

## 1.8 Forbidden

Everything in v0.5 §1.7 applies here unchanged. Restated for the two that this section exists because of:

- Do not set `overflow` on `AppShell`'s `<main>`, or otherwise modify `AppShell`, to make a filled page work.
- Do not compute a pixel height in a consuming page (`calc(100dvh - …)`, measuring `TopBar`, reading `clientHeight` to set a style). That hardcodes shell chrome into a page and breaks when the chrome changes; use `fill` and the height chain.
- Do not pair `fill` with `metadata` (§1.5).
- Do not nest a `fill` page inside another filled page.
