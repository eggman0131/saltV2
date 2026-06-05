# Salt 2.0 — UI Primitives Specification (v0.4)

**Status:** Planning  
**Scope:** `@salt/ui-components` — Combobox (incl. `ComboboxField`); ListPage Selection Mode (incl. `titleSlot`); SelectableList; EditableRow  
**Audience:** AI code-generation agents + human contributors

> Rule: If anything is missing or ambiguous → STOP → extend this spec → regenerate.  
> No invention beyond what is written here.

This document extends **v0.2** and **v0.3**.  
All global rules, architecture, naming, styling, and testing conventions from v0.2 remain in force.

---

## 0. v0.4 Scope

v0.4 introduces:

- **Combobox** — text input + popup listbox + filtering + optional custom values, with the optional `ComboboxField` joined-input frame (§3.4)
- **ListPage Selection Mode** — app-wide hide-by-default multi-select pattern, plus the `titleSlot` header override (§9)
- **SelectableList** — list template with `selectionMode`-gated per-row checkboxes (§10)
- **EditableRow** — single-row primitive with an `onToggleSelect`-gated checkbox (§11)

APG pattern: **Autocomplete (Listbox)**.

---

## 1. Combobox overview

### 1.1 Purpose

A text input that:

- Filters a list of options as the user types
- Shows a scrollable popup listbox
- Allows keyboard and pointer navigation
- Can be configured to:
  - **restrict** to the list only, or
  - **allow custom** values (create new entries)

### 1.2 APG mapping

- Base pattern: **WAI‑ARIA Combobox with Listbox Popup** (Autocomplete Listbox)
- Key semantics:
  - Input: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-autocomplete="list"`
  - Popup: `role="listbox"`
  - Items: `role="option"`
  - Active item: `aria-activedescendant` on input

---

## 2. Parts

- `Combobox.svelte` (Root)
- `ComboboxField.svelte` (optional input frame — joins input + trigger; see §3.4)
- `ComboboxInput.svelte`
- `ComboboxTrigger.svelte` (optional caret button)
- `ComboboxContent.svelte`
- `ComboboxItem.svelte`
- `ComboboxGroup.svelte`
- `ComboboxLabel.svelte`
- `ComboboxSeparator.svelte`
- `ComboboxEmpty.svelte` (shown when no results)
- `ComboboxCreate.svelte` (for “Create ‘X’” row when `allowCustom`)

---

## 3. Props and events

### 3.1 Root props (`Combobox`)

| Name           | Type                                               | Default        | Notes                             |
| -------------- | -------------------------------------------------- | -------------- | --------------------------------- |
| `value`        | string \| undefined (bindable)                     | undefined      | Selected value                    |
| `defaultValue` | string \| undefined                                | undefined      | Uncontrolled initial value        |
| `open`         | boolean (bindable)                                 | false          | Popup open state                  |
| `defaultOpen`  | boolean                                            | false          | Initial open state                |
| `items`        | Array<{ value: string; label: string }>            | []             | Full option list                  |
| `allowCustom`  | boolean                                            | false          | Allow values not in `items`       |
| `restrict`     | boolean                                            | false          | If true, must select from `items` |
| `name`         | string \| undefined                                | —              | Hidden input name                 |
| `placeholder`  | string \| undefined                                | —              | Input placeholder                 |
| `portal`       | HTMLElement \| string \| false                     | "body"         | Portal target for content         |
| `filterFn`     | (input: string, item: { value; label }) => boolean | default filter | Optional custom filter function   |
| `class`        | string \| undefined                                | —              | Root class                        |

> `allowCustom` and `restrict` are mutually exclusive.  
> If both are true → **STOP** and throw in dev.

### 3.2 Events

- `onValueChange: (value: string) => void`
- `onOpenChange: (open: boolean) => void`
- `onCreate?: (value: string) => void` — fired when a new custom value is created (only if `allowCustom`)

### 3.3 `ComboboxInput` props — HTML attribute forwarding

`ComboboxInput` accepts its own `class` plus **any standard `<input>` attribute**, which is spread onto the underlying `<input>` element. This lets callers attach `data-testid`, `disabled`, `name`, `aria-label`, `required`, etc. without `ComboboxInput` enumerating each one.

```ts
type ComboboxInputProps = Omit<
  HTMLInputAttributes,
  // props ComboboxInput owns and the headless layer controls — callers may NOT override these:
  | 'class' | 'id' | 'role' | 'type'
  | 'aria-expanded' | 'aria-controls' | 'aria-autocomplete' | 'aria-activedescendant'
  | 'value' | 'placeholder' | 'autocomplete'
  | 'onclick' | 'oninput' | 'onkeydown' | 'onblur'
> & { class?: string }
```

Contract:

- Forwarded attributes are spread **before** the component's own bindings, so the owned props above always win and cannot be clobbered by a caller.
- The ARIA/role/value/handler props are owned by the headless layer (§5.1) and are therefore excluded from the forwarded set — passing them is a type error.
- `placeholder` is supplied via the `Combobox` root prop (§3.1), not on `ComboboxInput`.

### 3.4 `ComboboxField` (optional input frame)

`ComboboxField` is an optional wrapper that visually joins the `ComboboxInput` with an adjacent control (e.g. a `ComboboxTrigger` caret button) into a single bordered frame, and registers itself as the floating anchor for the popup. When no `ComboboxField` wraps it, `ComboboxInput` registers itself as the anchor instead.

| Name       | Type                  | Default | Notes                          |
| ---------- | --------------------- | ------- | ------------------------------ |
| `class`    | `string \| undefined` | —       | Merged onto the frame `<div>`  |
| `children` | `Snippet`             | —       | The input and any sibling part |

**Styling (joined-input contract):**

```
'salt-focus-ring-within flex items-stretch rounded
 [&>input]:flex-1
 [&>input:not(:last-child)]:rounded-r-none
 [&>input:not(:last-child)]:border-r-0'
```

- The `:not(:last-child)` guard means a **standalone** input (no sibling rendered after it) keeps its own right border and right-side radius — the squared-off right edge only applies when a trailing sibling (e.g. trigger) is present to butt against. This avoids a clipped right border on single-input comboboxes.
- The frame uses the base `rounded` (4px) radius per the surface-radius rule (ui-spec-v02 §2.3).

---

## 4. Behaviour

### 4.1 Filtering

- Headless layer maintains:
  - `inputValue: string`
  - `filteredItems: items[]`
- Default filter:
  - Case-insensitive
  - Trims input
  - Matches when `item.label` contains the input substring
- `filterFn` (if provided) replaces default filter.

### 4.2 Keyboard interaction

When input is focused:

- `ArrowDown`:
  - If popup closed → open and move active to first filtered item
  - If open → move active to next item
- `ArrowUp`:
  - If popup closed → open and move active to last filtered item
  - If open → move active to previous item
- `Enter`:
  - If an item is active → select it, set `value`, close popup
  - If no item active:
    - If `allowCustom` → create new value, call `onCreate`, set `value`, close popup
    - If `restrict` → do nothing
- `Escape`:
  - Close popup
  - Restore `inputValue` to current `value` (if any)
- `Home` / `End`:
  - When popup open → jump active to first/last item
- `Tab`:
  - Commit current `value`
  - If `allowCustom` and input doesn’t match any item and no selection yet → treat as custom value

### 4.3 Pointer interaction

- Clicking `ComboboxTrigger` toggles `open`.
- Clicking an item selects it and closes popup.
- Mouse hover may update active item (optional; not required).

### 4.4 Scrolling

- When active item changes, `ComboboxContent` must ensure it is visible:
  - `itemElement.scrollIntoView({ block: 'nearest' })`

### 4.5 Restrict vs allowCustom

- `restrict = true`:
  - On blur:
    - If `inputValue` does not match any item’s label → revert to last valid `value` (or empty if none)
- `allowCustom = true`:
  - `ComboboxCreate` row appears when:
    - `inputValue` is non-empty
    - No filtered item has `label === inputValue`
  - Selecting `ComboboxCreate`:
    - Calls `onCreate(inputValue)`
    - Sets `value = inputValue`
    - Closes popup

### 4.6 Controlled/uncontrolled

- `value` + `onValueChange` → controlled
- `defaultValue` → uncontrolled
- `open` + `onOpenChange` → controlled
- `defaultOpen` → uncontrolled

---

## 5. Accessibility (APG requirements)

### 5.1 Input (`ComboboxInput`)

- `role="combobox"`
- `aria-expanded={open}`
- `aria-controls={listboxId}` when open
- `aria-autocomplete="list"`
- `aria-activedescendant={activeItemId}` when an item is active
- `id` used as label target (via external `<label>` or `aria-labelledby`)

### 5.2 Content (`ComboboxContent`)

- `role="listbox"`
- `id={listboxId}`
- `tabindex="-1"`

### 5.3 Items (`ComboboxItem`)

- `role="option"`
- `id={itemId}`
- `aria-selected={isSelected}`

### 5.4 Empty / Create

- `ComboboxEmpty`:
  - No special role required; treated as static content
- `ComboboxCreate`:
  - `role="option"`
  - `aria-selected={false}`

---

## 6. Headless API (shape only)

File: `src/headless/Combobox.headless.svelte.ts`

```ts
type ComboboxItem = { value: string; label: string }

type ComboboxProps = {
  value?: string
  defaultValue?: string
  items: ComboboxItem[]
  allowCustom?: boolean
  restrict?: boolean
  open?: boolean
  defaultOpen?: boolean
  filterFn?: (input: string, item: ComboboxItem) => boolean
}

export function createComboboxState(props: ComboboxProps) {
  // returns state + handlers used by all parts via context
}
Exposed state (conceptual):

- `inputValue: Writable<string>`
- `open: Writable<boolean>`
- `activeIndex: Writable<number | null>`
- `filteredItems: Readable<ComboboxItem[]>`
- `selectedValue: Writable<string | undefined>`

Exposed actions/handlers:

- `setInputValue(value: string)`
- `openPopup()`
- `closePopup()`
- `togglePopup()`
- `moveActive(delta: number)`
- `selectActive()`
- `selectItemByValue(value: string)`
- `createCustom(value: string)`

---

## 7. Testing requirements

- Roles and ARIA:
  - `role="combobox"` on input
  - `role="listbox"` on content
  - `role="option"` on items
  - `aria-expanded`, `aria-controls`, `aria-activedescendant`

- Keyboard:
  - Arrow navigation
  - Enter selection
  - Escape close + revert
  - Home/End behaviour
  - Tab commit behaviour

- Filtering:
  - Default filter behaviour
  - `filterFn` override

- Modes:
  - `restrict`:
    - Invalid input reverts on blur
  - `allowCustom`:
    - “Create” row appears correctly
    - `onCreate` fired

- Scrolling:
  - Active item scrolled into view

- Controlled vs uncontrolled:
  - `value`/`defaultValue`
  - `open`/`defaultOpen`

## 8. Additional decisions (pinned)

### 8.1 Duplicate labels in `items`
Allowed.

Rationale:
- Real datasets often contain duplicate labels (e.g., people with the same name).
- APG does not forbid duplicates.
- Salt identifies items internally by **index**, not by label.

Contract:
- `label` is for display and filtering only.
- `value` must be unique within the list.
- Active item is tracked by **index**, not by value.

### 8.2 Active item identification
Active item is identified by **index**.

Rationale:
- Filtering changes the visible list; indices are stable within `filteredItems`.
- `aria-activedescendant` uses the item’s DOM `id`, which is derived from the index in the filtered list.

Contract:
- Headless stores `activeIndex: number | null`.
- Items register in filtered order.
- No value-based active tracking.

### 8.3 Long lists / virtualization
**Virtualization is explicitly out of scope for v0.4.**

Rationale:
- Virtualization breaks the `scrollIntoView` guarantee.
- It requires a fundamentally different item registration model.
- It complicates ARIA because offscreen items may not exist in the DOM.

Contract:
- All items in `filteredItems` are rendered in the DOM.
- `scrollIntoView({ block: 'nearest' })` is required and reliable.
- Virtualization may be considered in a future major version.

### 8.4 Async items / loading state
Out of scope for v0.4.

Rationale:
- Async data introduces loading, error, and empty states that complicate the headless API.
- v0.4 focuses on the core APG pattern with static `items`.

Contract:
- `items` is a synchronous array.
- If the user wants async behaviour, they must manage it externally and pass updated `items` down.
- No built-in loading spinner or async fetch behaviour.

### 8.5 `ComboboxEmpty` accessibility
`ComboboxEmpty` is **non-focusable** and **aria-hidden**.

Rationale:
- It is not an option.
- It should not be reachable by keyboard.
- Screen readers should not treat it as a selectable item.

Contract:
- `ComboboxEmpty` renders with:
  - `aria-hidden="true"`
  - `tabindex="-1"`
- It must never be assigned an `id` or used as `aria-activedescendant`.

### 8.6 `ComboboxCreate` accessibility
`ComboboxCreate` **is** an option.

Contract:
- `role="option"`
- `aria-selected="false"`
- It participates in active item movement.
- It is included in `filteredItems` as a synthetic final entry when conditions are met.

### 8.7 Matching behaviour for custom creation
Exact-match rule:

- If `allowCustom` is true:
  - `ComboboxCreate` appears **only** when:
    - `inputValue` is non-empty
    - AND no item has `label === inputValue` (case-insensitive exact match)

Rationale:
- Prevents duplicate creation of existing items.
- Matches behaviour of Radix, MUI, and Reach.

```

---

# 9. ListPage — Selection Mode

## 9.1 Overview

`ListPage` supports an app-wide **Selection Mode** pattern: multi-select is hidden by default; the list is "clean" with only each row's primary action visible. A built-in **"Select" button** in the page header switches into selection mode, revealing the `selectionBar` and per-row select controls. A **"Done" button** (replacing "Select" in the header) exits selection mode.

Pattern precedent: iOS Reminders, Apple Mail, Google Tasks, Todoist.

## 9.2 Behaviour

### Default state (selection mode off)
- No per-row select checkboxes are visible.
- The `selectionBar` snippet is not rendered.
- The header shows a "Select" `outline`, `size="sm"` button (only when a `selectionBar` snippet is provided).

### Selection mode on
- The `selectionBar` snippet is rendered in the grey bar between toolbar and content.
- Per-row select controls become visible (consuming pages gate them on their page-local `selectionMode` — see §9.4).
- The "Select" button is replaced by a "Done" `outline`, `size="sm"` button in the header.

> Button variant: the Select/Done toggle uses `variant="outline"` (not `ghost`) so it reads as an affordance against the header background and lines up with the `size="sm"` convention documented on the `actions` prop.

### Exiting selection mode
- Tapping "Done" sets `selectionMode = false` inside `ListPage`, which propagates back to the consuming page via the binding.
- The `selectionBar` is hidden again; per-row controls disappear.
- Consuming pages clear their `selected` Set by reacting to `selectionMode` becoming `false` (see §9.5).

## 9.3 `ListPage` props changes

One new prop: `selectionMode?: boolean` (bindable, default `false`). Consuming pages bind to it to observe and react to mode state. The "Select"/"Done" toggle still appears automatically whenever a `selectionBar` snippet is provided — the page never needs to manage the toggle itself.

`ListPageProps` is an open interface that extends `Omit<HTMLAttributes<HTMLElement>, 'class'>`. Any attribute valid on `<section>` is accepted and spread onto the root `<section>` element (e.g. `data-*`, `aria-*`, `id`). The `class` prop is reserved and handled internally.

### `titleSlot` — custom header title

`titleSlot?: Snippet`. When provided, it **replaces** the default `<h1>{title}</h1>` in the page header. When omitted, the page renders the default `<h1>` from the `title` string.

Use this when a page needs an interactive element in place of a static heading — e.g. a `Combobox` for switching between shopping lists, or an editable title. The `title` string prop is still required (it remains the accessible/programmatic name and the fallback); `titleSlot` only overrides the *rendered* heading.

```svelte
<ListPage title="Shopping list">
  {#snippet titleSlot()}
    <ListSwitcherCombobox … />
  {/snippet}
</ListPage>
```

Contract:

- `titleSlot` and `title` are not mutually exclusive — `title` must always be passed; `titleSlot` is the optional visual override.
- A `titleSlot` that renders no heading element should still provide an accessible name for the region (the page's `title` covers the section's labelling).

## 9.4 Consuming-page contract (bindable prop)

Consuming pages use `bind:selectionMode` to observe selection state in their own scripts and templates. This is the correct approach because consuming pages are *parents* of `ListPage` — Svelte context flows downward (parent → child), so `LIST_PAGE_CONTEXT.get()` cannot be called from a consuming page's `<script>` block (it would throw outside the component tree).

**Standard pattern for a consuming page:**
```svelte
<script lang="ts">
  let selectionMode = $state(false);
  let selected = $state(new Set<string>());

  $effect(() => {
    if (!selectionMode) selected = new Set();
  });
</script>

<ListPage ... bind:selectionMode>
  {#snippet children()}
    {#if selectionMode}
      <Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(item.id)} label="" />
    {/if}
  {/snippet}
</ListPage>
```

## 9.5 Clearing selection on exit

Consuming pages own their `selected` Set. When selection mode exits the bound `selectionMode` becomes `false`; a top-level `$effect` reacts and clears it:

```ts
$effect(() => {
  if (!selectionMode) selected = new Set();
});
```

## 9.6 Programmatic exit

To exit selection mode programmatically from a consuming page (e.g., after a bulk delete completes), set the bound state directly:

```ts
selectionMode = false; // propagates into ListPage via the binding; triggers the $effect above
```

## 9.7 Context — for nested components only

`ListPage` still publishes selection state via `LIST_PAGE_CONTEXT` (`@salt/ui-components`). This is intended for **components instantiated inside `ListPage`'s rendered tree** (e.g., a future shared row component that needs to know the mode without prop-drilling through the page's snippet markup).

```ts
// Only call this inside a component whose init runs inside ListPage's tree:
import { LIST_PAGE_CONTEXT } from '@salt/ui-components';
const ctx = LIST_PAGE_CONTEXT.get(); // throws if called outside ListPage's tree
```

`ListPageContext` shape:
```ts
type ListPageContext = {
  readonly selectionMode: boolean;        // reactive via getter
  readonly exitSelectionMode: () => void; // sets selectionMode = false
};
```

Do **not** call `LIST_PAGE_CONTEXT.get()` in a consuming page's own `<script>` block — use `bind:selectionMode` instead (§9.4).

## 9.8 Forbidden

- Do not re-implement the "Select"/"Done" toggle in consuming pages.
- Do not call `LIST_PAGE_CONTEXT.get()` from a consuming page's `<script>` block — it is outside the context tree and will throw.

---

# 10. SelectableList (template)

## 10.1 Overview

`SelectableList<T>` renders a vertical list of rows from an `items` array, each row produced by a caller-supplied `row` snippet, with an optional per-row select `Checkbox` driven by a bound `selected` Set. It is the row-rendering counterpart to `ListPage`'s Selection Mode (§9): a consuming page typically passes its own `selectionMode` down so the checkboxes appear only while selecting.

## 10.2 Props

| Name            | Type                                                       | Default          | Notes                                                       |
| --------------- | ---------------------------------------------------------- | ---------------- | ----------------------------------------------------------- |
| `items`         | `T[]` where `T extends { id: string }`                     | —                | Rows to render; keyed by `item.id`                          |
| `selected`      | `Set<string>` (bindable)                                   | `new Set()`      | IDs currently selected                                      |
| `selectionMode` | `boolean`                                                  | `false`          | When `false`, the per-row `Checkbox` is **not rendered**    |
| `row`           | `Snippet<[T, { selected: boolean; toggle: () => void }]>`  | —                | Renders each row's content; receives the item + row helpers |
| `class`         | `string \| undefined`                                      | —                | Merged onto the `<ul>`                                      |

## 10.3 Behaviour

- **`selectionMode` gates the checkbox.** When `selectionMode` is `false` (the default), no `Checkbox` is rendered and the list reads as a plain, clean list. When `true`, each row renders a leading `Checkbox` bound to membership in `selected`.
- Toggling a row's checkbox (or calling the `toggle` helper passed into the `row` snippet) adds/removes that `item.id` from `selected` immutably (a new `Set` is assigned so bindings react).
- Selected rows get a `ring-2 ring-ring border-ring` treatment on the row container.
- Rows use the base `rounded` (4px) surface radius (ui-spec-v02 §2.3).

> **Default-off is a deliberate, behaviour-breaking contract.** A caller that does not pass `selectionMode` gets **no** checkboxes. This matches the app-wide hide-by-default selection pattern (§9.2); it is not a regression.

## 10.4 Accessibility

- The list root is a `<ul>`; each row is an `<li>`.
- When rendered, the `Checkbox` carries the selection state for assistive tech; the `row` snippet is responsible for the row's own accessible label/content.

## 10.5 Testing requirements

- Checkbox is **absent** when `selectionMode={false}` (default) and **present** when `selectionMode={true}`.
- Toggling a checkbox updates the bound `selected` Set (add and remove).
- Selected rows reflect the selected styling.
- `row` snippet receives the correct `selected` flag and a working `toggle`.

---

# 11. EditableRow (primitive)

## 11.1 Overview

`EditableRow` is a single list-row primitive with an optional leading select `Checkbox` and responsive `narrow` / `wide` content snippets. It is used by pages that render editable rows (e.g. canon, aisles, equipment) and want a consistent row chrome with optional multi-select.

## 11.2 Props

| Name             | Type                  | Default | Notes                                                            |
| ---------------- | --------------------- | ------- | ---------------------------------------------------------------- |
| `selected`       | `boolean`             | `false` | Whether the row is selected (drives ring styling + checkbox)     |
| `shaded`         | `boolean`             | `false` | Amber "needs attention" styling instead of the default surface   |
| `onToggleSelect` | `(() => void) \| undefined` | `undefined` | Select handler. **When `undefined`, the `Checkbox` is not rendered** |
| `narrow`         | `Snippet`             | —       | Row content shown below the `sm` breakpoint                      |
| `wide`           | `Snippet`             | —       | Row content shown at/above the `sm` breakpoint                   |

## 11.3 Behaviour

- **`onToggleSelect` presence gates the checkbox.** When `onToggleSelect` is `undefined` (the default), no leading `Checkbox` is rendered. When a handler is passed, the `Checkbox` appears, reflects `selected`, and calls `onToggleSelect` on change. This mirrors `SelectableList.selectionMode` (§10.3): a page passes `onToggleSelect` only while in selection mode.
- `shaded` switches the row to the amber attention palette; `selected` adds a `ring-2 ring-ring` treatment in both palettes.
- The row uses the base `rounded` (4px) surface radius (ui-spec-v02 §2.3).
- `narrow` is shown on small screens (`sm:hidden`); `wide` is shown from `sm` upward (`hidden sm:flex`).

## 11.4 Testing requirements

- `Checkbox` is **absent** when `onToggleSelect` is `undefined` and **present** when a handler is passed.
- The `Checkbox` reflects `selected` and invokes `onToggleSelect` on change.
- `shaded` and `selected` styling render as specified.
- `narrow` and `wide` snippets render at the correct breakpoints.
