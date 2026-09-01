# Salt 2.0 — UI Primitives Specification (v0.14)

**Status:** Planning  
**Scope:** `@salt/ui-components` — `PopoverMenuItem`  
**Audience:** AI code-generation agents + human contributors

> Rule: If anything is missing or ambiguous → STOP → extend this spec → regenerate.  
> No invention beyond what is written here.

This document extends **v0.2** through **v0.13**.  
All global rules, architecture, naming, styling, and testing conventions from v0.2 remain in force, as does v0.2 §8.7 (`Popover`) — this spec adds one component to that compound and changes nothing about the three parts already in it.

---

## 0. v0.14 Scope

v0.14 introduces:

- **`PopoverMenuItem`** — one row of a popover menu: a label, an optional leading glyph, and a press (§8.33)

Nothing in v0.14 changes any existing component. `Popover`, `PopoverTrigger` and `PopoverContent` are untouched — no new prop, no change to `popoverContentClass`, no change to portal or focus behaviour.

---

# 8.33 PopoverMenuItem

## 8.33.1 Overview

A **`PopoverMenuItem`** is one row of the menu a `PopoverContent` holds: a label,
optionally a leading glyph, and a press. It is the smallest unit of the pattern
`Popover` has always been used for and never supplied.

It is a `<button type="button">`, always. A menu row that navigates still
presses — the navigation happens in the handler — because the surrounding
`Popover` has to close, and an `<a>` that also has to run `open = false` is a
link pretending not to be one.

## 8.33.2 Why this exists (issue #930)

`@salt/ui-components` shipped `Popover`, `PopoverTrigger` and `PopoverContent`
and stopped there, so every page wrote the row itself:

```svelte
<button
  type="button"
  class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
  onclick={…}
  data-testid="…"
>
  <Icon name="Pencil" size={14} />
  Edit
</button>
```

By the #894 architecture review that string appeared **26 times across 3 pages**.
By the re-read a week later it was **28 across 4**. Nothing mechanical stopped
it, so each new menu added to the pile — and each copy is an independent chance
to get the padding, the hover ground or the icon size subtly wrong.

The four shapes those 28 took, and what became of each:

| shape       | count | what it was                                                              | in this component              |
| ----------- | ----- | ------------------------------------------------------------------------ | ------------------------------ |
| plain       | 20    | the base string                                                          | the default                    |
| disabled    | 5     | base + `disabled:opacity-50`                                             | folded into the base — §8.33.5 |
| destructive | 2     | `text-destructive hover:bg-destructive/10` in place of `hover:bg-accent` | `variant="destructive"`        |
| selected    | 1     | base minus `gap-2`, plus `font-medium`                                   | `selected` — §8.33.6           |

## 8.33.3 Anatomy

```
┌──────────────────────────────────────────┐
│  [glyph]  Label                          │   ← one row, full width of the menu
└──────────────────────────────────────────┘
```

- **Glyph** — optional, 14px, leading. Named, never drawn by the caller (§8.33.7).
- **Label** — the row's `children`. Text.
- **Row** — `flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm`, plus
  the hover ground its variant chooses.

## 8.33.4 Props

| prop          | type                         | default     | notes                                                                          |
| ------------- | ---------------------------- | ----------- | ------------------------------------------------------------------------------ |
| `variant`     | `'default' \| 'destructive'` | `'default'` | which hover ground, and whether the label is destructive-coloured              |
| `icon`        | `IconName \| undefined`      | —           | a leading glyph from the closed registry, rendered at 14px                     |
| `iconVisible` | `boolean`                    | `true`      | when `false`, the glyph still occupies its column but is not painted (§8.33.8) |
| `selected`    | `boolean`                    | `false`     | marks the row as the chosen one by weight (§8.33.6)                            |
| `disabled`    | `boolean`                    | `false`     | native; the row also dims (§8.33.5)                                            |
| `children`    | `Snippet`                    | —           | the label                                                                      |
| `class`       | `string`                     | —           | merged last, as everywhere in this package                                     |

Everything else — `onclick`, `data-testid`, `data-*`, `title`, `aria-*` — rides
`...rest` onto the button, as `Chip` does (v0.9 §8.23.3).

## 8.33.5 The dim is unconditional, and that is the point

`disabled:opacity-50` is in the **base** class string, not in a variant keyed on
the `disabled` prop.

It is a `disabled:` variant utility: it selects `:disabled`, so on a row that is
not disabled it matches nothing and paints nothing. Making it conditional would
mean a component whose dimming depends on the author having asked for dimming
rather than on the row being disabled — which is precisely the hand-authoring
accident this component exists to end. Of the 28 rows it replaced, the five
carrying the class were exactly the five passing a `disabled` attribute; the
correlation was perfect, and it was maintained by hand.

## 8.33.6 `selected` marks the chosen row, and does not announce it

`selected` adds `font-medium` and nothing else. It is a **presentational**
distinction, not a semantic one: it sets no `aria-checked`, no `aria-current` and
no `role="menuitemradio"`.

That is deliberate and it is a limitation, stated rather than papered over. The
one row using it — the shopping list's list-switcher — is a navigation menu whose
"selected" entry means _the list you are already looking at_, and the correct
announcement for that is a matter for the menu, not for the row. A future menu
that genuinely is a radio group needs the ARIA, and §8.33 must be amended before
it is added rather than a caller passing `aria-checked` through `...rest`.

## 8.33.7 The glyph is named, never drawn

`icon` takes an `IconName` from the closed registry and the component renders
`<Icon name={icon} size={14} />` itself. It is not a `Snippet`.

The reasoning is v0.9 §8.23.8's, amended after #1051, and it applies unchanged
here: TypeScript cannot see inside a `Snippet`, so a slot invites a pictogram or
a wrongly-sized glyph and the only guarantee against it is a CSS selector that a
`<span><img></span>` does not match. A name from the registry makes the wrong
thing unrepresentable instead of merely discouraged. 14px, not the chip's 12px,
because a menu row is `text-sm` and the glyph is sized against the label.

## 8.33.8 `iconVisible` reserves the column

Three of the 28 rows were mutually exclusive options marked by a leading tick,
written as `<Icon name="Check" class={chosen ? '' : 'invisible'} />`. The
`invisible` rather than a conditional `{#if}` is load-bearing: the unchosen rows
must keep the tick's width, or the labels in the menu do not line up.

`iconVisible={false}` renders the glyph and hides it, preserving that column. It
is meaningless without `icon` and the type says so.

## 8.33.9 What it does not do

- **No submenu, no separator, no group heading.** The pages that need a heading
  render a `<p>` above the rows, and that stays a caller concern until a second
  page wants the same one.
- **No `role="menu"` / `role="menuitem"`.** `PopoverContent` is not a menu
  container and does not manage roving focus; adding item roles without the
  container's keyboard contract would announce a pattern the component does not
  implement. Tab order is the DOM's, which is what these menus have always had.
- **No size axis.** One size, as `Chip` has one size (v0.9 §8.23.5).

## 8.33.10 Testing

Beyond v0.2 §7's baseline:

- The resolved class string for each of `default`, `destructive`, `selected` and
  the disabled row, pinned — these are what the 28 call sites used to write, and
  a silent change to any of them is a silent change to every menu in the app.
- `icon` renders at 14px; `iconVisible={false}` keeps the element and adds
  `invisible`; no `icon` renders no glyph.
- `disabled` reaches the button as the native attribute, so `:disabled` can
  match — without it the base's `disabled:opacity-50` is decoration.
