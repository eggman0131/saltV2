# Salt 2.0 — UI Primitives Specification (v0.4)

**Status:** Planning  
**Scope:** `@salt/ui-components` — Combobox (incl. `ComboboxField`); ListPage Selection Mode (incl. `titleSlot`); list selection (`createListSelection` + `SelectableList` / `SelectAllCheckbox` / `RowSelectCheckbox`); EditableRow  
**Audience:** AI code-generation agents + human contributors

> Rule: If anything is missing or ambiguous → STOP → extend this spec → regenerate.  
> No invention beyond what is written here.

This document extends **v0.2** and **v0.3**.  
All global rules, architecture, naming, styling, and testing conventions from v0.2 remain in force.

---

## 0. v0.4 Scope

v0.4 introduces:

- **Combobox** — text input + popup listbox + filtering + optional custom values, with the optional `ComboboxField` joined-input frame (§3.4)
- **ListPage Selection Mode** — app-wide hide-by-default multi-select with a **contextual bottom action bar** (`bulkActions`, incl. a move/target-picker sheet) that replaces the `BottomNav`, plus deferred-delete + Undo and the `titleSlot` header override (§9)
- **List selection** — one shared `createListSelection` controller behind `SelectableList`, `SelectAllCheckbox`, and `RowSelectCheckbox`, so every list page shares the same selection logic instead of hand-rolling it (§10)
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
| `openOnClick`  | boolean                                            | true           | If false, clicking/focusing the input does **not** open the popup — it opens only once the user types. Shopping-list add field sets this `false`; canon page keeps the default |
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
- Clicking/focusing `ComboboxInput` opens the popup **only when `openOnClick` is true** (the default). When `openOnClick` is false, the popup stays closed until the user types; the `ComboboxTrigger` caret still toggles `open` regardless.
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

`ListPage` supports an app-wide **Selection Mode** built around a **contextual action mode** (Android-style): multi-select is hidden by default; the list is "clean" with only each row's primary action visible. A built-in **"Select" button** in the page header switches into selection mode, revealing the top **select-all** control (`selectionBar`) and per-row select controls. A **"Done" button** (replacing "Select" in the header) exits selection mode.

Once at least one item is selected, bulk actions appear in a **contextual bottom action bar** that the template renders and that **replaces** the app's `BottomNav` (it is painted over the nav at a higher z-index, not stacked above it). Pages declare these actions declaratively via the `bulkActions` prop — they do **not** render their own bottom bar. A `picker`-type action (e.g. "Move to…") opens a template-owned bottom `Sheet` of targets. Bulk **delete** uses **deferred-delete + an Undo snackbar** — items hide immediately and the real delete commits only when the undo window lapses; there is **no confirm dialog** and **no soft-delete/tombstones** (see §9.3.3).

Pattern precedent: Android contextual action bar; iOS Reminders/Mail multi-select.

## 9.2 Behaviour

### Default state (selection mode off)
- No per-row select checkboxes are visible.
- The `selectionBar` (top select-all) snippet is not rendered, and no contextual bottom bar is shown.
- The header shows a "Select" `outline`, `size="sm"` button (only when a `selectionBar` snippet is provided).

### Selection mode on
- The `selectionBar` snippet (typically a single select-all `Checkbox`) is rendered in the bar between toolbar and content.
- Per-row select controls become visible (consuming pages gate them on their page-local `selectionMode` — see §9.4).
- The "Select" button is replaced by a "Done" `outline`, `size="sm"` button in the header.
- **Once `selectionCount > 0`**, the contextual bottom action bar (`bulkActions`) appears, replacing the `BottomNav`; the template reserves matching bottom content padding so the last rows are not hidden behind it.

> Button variant: the Select/Done toggle uses `variant="outline"` (not `ghost`) so it reads as an affordance against the header background and lines up with the `size="sm"` convention documented on the `actions` prop.

### Exiting selection mode
- Tapping "Done" sets `selectionMode = false` inside `ListPage`, which propagates back to the consuming page via the binding.
- The `selectionBar`, per-row controls, and the contextual bottom bar are all hidden again; the `BottomNav` returns.
- Consuming pages clear their `selected` Set by reacting to `selectionMode` becoming `false` (see §9.5).

## 9.3 `ListPage` props changes

Three selection-related props:

- `selectionMode?: boolean` (bindable, default `false`). Consuming pages bind to it to observe and react to mode state. The "Select"/"Done" toggle still appears automatically whenever a `selectionBar` snippet is provided — the page never needs to manage the toggle itself.
- `selectionCount?: number` (default `0`). The number of currently-selected items. Drives contextual-bar visibility (the bar shows only when `selectionMode && selectionCount > 0`) and the default picker-sheet title. The page owns selection state; this prop is just the count.
- `bulkActions?: BulkAction[]`. The actions rendered in the contextual bottom bar (§9.3.1).

`ListPageProps` is an open interface that extends `Omit<HTMLAttributes<HTMLElement>, 'class'>`. Any attribute valid on `<section>` is accepted and spread onto the root `<section>` element (e.g. `data-*`, `aria-*`, `id`). The `class` prop is reserved and handled internally.

### 9.3.1 `BulkAction` — declarative contextual bar

Each bar entry is a `BulkAction`. The template owns the bar chrome (layout, icon-over-label buttons, destructive tint, disabled state) so every list page looks identical; pages supply only data + handlers. Icons are names from the shared `Icon` set (`BulkActionIcon = keyof typeof import('@lucide/svelte').icons`).

```ts
type BulkAction =
  | {
      kind?: 'button';            // default
      id: string;                 // stable key
      label: string;              // "Check", "Delete"
      icon: BulkActionIcon;       // "CircleCheck", "Trash2"
      variant?: 'default' | 'destructive';
      disabled?: boolean;
      testId?: string;            // data-testid override (else "list-page-bulk-action")
      onSelect: () => void;
    }
  | {
      kind: 'picker';             // opens a template-owned bottom Sheet of targets
      id: string;
      label: string;              // "Move"
      icon: BulkActionIcon;       // "FolderInput"
      disabled?: boolean;
      testId?: string;
      sheetTitle?: string;        // "Move 3 items to…" (defaults to label)
      targets: { id: string; label: string }[];
      optionTestId?: string;      // data-testid for each option (else "list-page-bulk-picker-option")
      onPick: (targetId: string) => void;
    };
```

Worked call-site (shopping):

```svelte
<ListPage
  bind:selectionMode
  selectionCount={selectedCount}
  bulkActions={[
    { id: 'check',   label: 'Check',   icon: 'CircleCheck', onSelect: handleBulkCheck },
    { id: 'uncheck', label: 'Uncheck', icon: 'Circle',      onSelect: handleBulkUncheck },
    { kind: 'picker', id: 'move', label: 'Move', icon: 'FolderInput',
      disabled: otherLists.length === 0,
      sheetTitle: `Move ${selectedCount} item${selectedCount === 1 ? '' : 's'} to…`,
      targets: otherLists.map((l) => ({ id: l.id, label: l.name })),
      onPick: handleMoveTo },
    { id: 'delete', label: 'Delete', icon: 'Trash2', variant: 'destructive', onSelect: handleBulkDelete },
  ]}
>
  {#snippet selectionBar()}<Checkbox … />{/snippet}
  {#snippet children()}…rows…{/snippet}
</ListPage>
```

### 9.3.2 Move / target picker

A `kind: 'picker'` action renders, in the bottom bar, a button that opens a template-owned bottom `Sheet` listing `targets`. Selecting one fires `onPick(targetId)` and closes the sheet. The template owns the sheet entirely — pages do not render their own move sheet. Use a picker for "move into one of N containers" flows (shopping lists, folders); use a plain `button` action whose `onSelect` opens a bespoke `Dialog` for genuinely complex flows that the simple target list can't represent (e.g. aisle merge with per-item choices, or an aisle delete that must disclose affected items).

### 9.3.3 Deferred bulk delete + Undo snackbar

The canonical bulk-delete is **deferred-delete + Undo snackbar, with no confirm dialog and no soft-delete/tombstones** (true to Firestore-as-master): selected items hide immediately, and the real Firestore delete commits only once the Undo toast lapses. Pressing **Undo** cancels the commit, so nothing is ever deleted and no restore path is required.

`ListPage` stays toast-free — the toast is app-level (§ Toast / `toastStore`), because `@salt/ui-components` must not depend on the app's toast store. The repeated hide → commit → undo orchestration lives in the shared web-pwa helper `createDeferredDelete()` (`apps/web-pwa/src/lib/deferredDelete.svelte.ts`):

```ts
const deferredDelete = createDeferredDelete();
// hide pending-deleted rows from rendering:
const visibleItems = $derived(deferredDelete.visible($items));

function handleBulkDelete() {
  const ids = [...selected];
  selectionMode = false;
  deferredDelete.request(ids, async (delIds) => {
    const result = await removeItems(delIds);
    if (result.kind !== 'ok') addToast('Failed to delete items.', 'destructive');
  });
}
```

A `Delete` `BulkAction` (`variant: 'destructive'`) simply calls the page's `handleBulkDelete` from `onSelect`; the template renders the button but owns none of the delete semantics. Pages with consequential structural deletes that need disclosure (aisle management) keep a `Dialog`, triggered from a bar action's `onSelect` instead.

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
- Do not render a bespoke bottom action bar or move/target `Sheet` in a consuming page — declare `bulkActions` (incl. `kind: 'picker'`) and let `ListPage` own the chrome. (Pre-`#115` pages each hand-rolled a `fixed bottom-0` bar; that is now superseded.)
- Do not gate bulk **delete** behind a confirm dialog or implement soft-delete/tombstones — use the deferred-delete + Undo pattern via `createDeferredDelete()` (§9.3.3). The only exception is a consequential structural delete that must disclose side-effects (aisle management), which may keep a `Dialog` triggered from a bar action.
- Do not call `LIST_PAGE_CONTEXT.get()` from a consuming page's `<script>` block — it is outside the context tree and will throw.

---

# 10. List selection (`createListSelection` + `SelectableList` / `SelectAllCheckbox` / `RowSelectCheckbox`)

## 10.1 Overview

Multi-selection across the app's list pages is owned by **one** shared controller, `createListSelection`, plus three thin presentational components that read from it. Before, every list page (shopping, canon, aisle, equipment) hand-rolled the same `selected` Set, the `allSelected` / `someSelected` / `count` deriveds, the `toggle` / `toggleAll` helpers, the auto-clear `$effect`, and its own select-all / per-row checkboxes. That logic now lives once, in the controller.

The pieces:

- **`createListSelection(options)`** — the selection "brain". Owns the `selected` Set and derives `allSelected` / `someSelected` / `count` from a scope (`getAllIds`). Sources selection mode from the page (`isSelectionMode`) and **auto-clears the selection when mode turns off**, replacing the per-page `$effect`.
- **`SelectableList<T>`** — renders a flat `<ul>` of rows from `items`, each produced by a caller `row` snippet, with the per-row select checkbox gated on `selection.selectionMode`. Used for simple flat lists (equipment).
- **`SelectAllCheckbox`** — the header/`selectionBar` select-all control (tri-state + "N selected" label), wired entirely from the controller.
- **`RowSelectCheckbox`** — a single per-row select checkbox wired to the controller by `id`, for pages whose row layout is bespoke (shopping's trolley rows, aisle's drag-drop `SortableList` rows) and so cannot use `SelectableList`'s flat container.

> **Why a controller, not one mega-component.** The four lists are structurally divergent — flat (equipment), grouped + sectioned (canon, shopping), collapsible (shopping), and drag-drop sortable (aisle). Forcing them all through a single list container would couple selection to grouping/sorting. Instead the *selection logic* is unified in the controller; each page keeps its own structure and composes the shared checkboxes. Canon reuses `EditableRow`'s built-in checkbox (driven by the controller via `selected` / `onToggleSelect`).

> **Scope: selection only.** None of these own bulk actions. Bulk actions belong to `ListPage`'s contextual action bar via `bulkActions` (§9.3.1). A page composes the list/checkboxes inside `ListPage`'s `children` / `selectionBar` and declares `bulkActions` on the `ListPage`, passing `selectionCount={selection.count}`.

## 10.2 `createListSelection(options)`

**Options**

| Name              | Type               | Notes                                                                 |
| ----------------- | ------------------ | --------------------------------------------------------------------- |
| `getAllIds`       | `() => string[]`   | All currently-selectable ids in scope; drives `all`/`some`/`count` + `toggleAll` |
| `isSelectionMode` | `() => boolean`    | Page's selection mode (bound to `ListPage`); selection clears on exit |

**Returns `ListSelection`**

| Member         | Type                       | Notes                                                          |
| -------------- | -------------------------- | -------------------------------------------------------------- |
| `selectionMode`| `boolean` (readonly)       | Mirror of `isSelectionMode()`                                  |
| `selected`     | `Set<string>` (readonly)   | Live selected ids (reactive)                                   |
| `ids`          | `string[]` (readonly)      | Selected ids still in scope (`getAllIds`)                      |
| `count`        | `number` (readonly)        | `ids.length`                                                   |
| `allSelected`  | `boolean` (readonly)       | Every in-scope id selected                                     |
| `someSelected` | `boolean` (readonly)       | Some, but not all, in-scope ids selected                       |
| `isSelected(id)`| `(id) => boolean`         | Membership test                                                |
| `toggle(id)`   | `(id) => void`             | Add/remove one id (immutable Set swap)                         |
| `toggleAll()`  | `() => void`               | Select all in-scope, or clear when all already selected        |
| `add(ids)`     | `(ids) => void`            | Add a subset (e.g. "select all pending")                       |
| `remove(ids)`  | `(ids) => void`            | Remove a subset (e.g. after a partial bulk action)             |
| `clear()`      | `() => void`               | Clear the whole selection                                      |

## 10.3 Component props

**`SelectableList<T>`**

| Name        | Type                                                      | Default | Notes                                          |
| ----------- | -------------------------------------------------------- | ------- | ---------------------------------------------- |
| `items`     | `T[]` where `T extends { id: string }`                   | —       | Rows to render; keyed by `item.id`             |
| `selection` | `ListSelection`                                          | —       | Shared controller; gates + drives the checkbox |
| `row`       | `Snippet<[T, { selected: boolean; toggle: () => void }]>`| —       | Renders each row's content                     |
| `getRowCheckboxLabel` | `((item: T) => string) \| undefined`           | see Notes | Accessible label for each row's select checkbox; defaults to ``(item) => `Select ${item.id}` `` when omitted |
| `class`     | `string \| undefined`                                    | —       | Merged onto the `<ul>`                         |

**`SelectAllCheckbox`** — `{ selection: ListSelection }` (extra attrs forwarded to `Checkbox`).
**`RowSelectCheckbox`** — `{ selection: ListSelection; id: string }` (extra attrs — `aria-label`, `labelledBy`, `data-testid`… — forwarded to `Checkbox`).

## 10.4 Behaviour

- **`selection.selectionMode` gates the per-row checkbox.** When mode is off, `SelectableList` renders no checkbox and reads as a plain list; bespoke pages gate their `RowSelectCheckbox` behind their own `{#if selectionMode}`.
- `toggle` / `toggleAll` / `add` / `remove` mutate the selection immutably (a new `Set` is assigned so deriveds and bindings react).
- Leaving selection mode (`isSelectionMode()` → `false`) clears the selection automatically.
- Selected rows in `SelectableList` get a `ring-2 ring-ring border-ring` treatment; rows use the base `rounded` (4px) surface radius (ui-spec-v02 §2.3).

## 10.5 Accessibility

- `SelectableList`'s root is a `<ul>`; each row is an `<li>`.
- The select checkboxes carry selection state for assistive tech; the `row` snippet (or bespoke row) is responsible for the row's own accessible label/content. `SelectAllCheckbox` exposes a "Select all" / "N selected" label.

## 10.6 Testing requirements

- Per-row checkbox is **absent** when `selection.selectionMode` is `false` and **present** when `true`.
- Toggling a checkbox updates the controller's selection (add and remove); `toggleAll` selects/clears the in-scope set.
- Leaving selection mode clears the selection.
- Selected rows reflect the selected styling; the `row` snippet receives the correct `selected` flag and a working `toggle`.

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

---

# 12. Markdown (primitive)

## 12.1 Overview

`Markdown` is a lightweight read-only Markdown renderer. It wraps [`svelte-exmarkdown`](https://www.npmjs.com/package/svelte-exmarkdown) with the GFM (GitHub Flavored Markdown) plugin and scopes all output under the `salt-md` CSS class so host pages never need to supply prose styles.

Primary use case: rendering AI-generated assistant responses in the chat UI (AI Kitchen Assistant). The primitive lives in `@salt/ui-components` so any future feature that needs rich-text display can reuse it without pulling in a second Markdown library.

## 12.2 Props

| Name    | Type                  | Default | Notes                                                      |
| ------- | --------------------- | ------- | ---------------------------------------------------------- |
| `text`  | `string`              | —       | Markdown source string to render                           |
| `class` | `string \| undefined` | —       | Extra classes merged onto the `salt-md` wrapper `<div>`    |

## 12.3 Implementation

- **File:** `packages/ui-components/src/primitives/Markdown/Markdown.svelte`
- **Renderer:** `svelte-exmarkdown` (`<Markdown md={text} plugins={[gfmPlugin()]} />`)
- **Plugin:** `gfmPlugin()` from `svelte-exmarkdown/gfm` — adds tables, strikethrough, task lists, and autolinks.
- **Wrapper:** `<div class={cn('salt-md', className)}>` — the `salt-md` scope prevents styles from leaking into or out of the component.

## 12.4 `salt-md` CSS scope

All styles are applied via `:global()` selectors scoped under `.salt-md` so they target only `svelte-exmarkdown`'s rendered HTML without polluting the rest of the app.

| Element          | Style applied                                                           |
| ---------------- | ----------------------------------------------------------------------- |
| `:first-child`   | `margin-top: 0`                                                         |
| `:last-child`    | `margin-bottom: 0`                                                      |
| `p`              | `margin: 0`; successive paragraphs separated by `0.5rem` top margin     |
| `ul`             | `margin: 0.25rem 0; padding-left: 1.25rem; list-style: disc`           |
| `ol`             | `margin: 0.25rem 0; padding-left: 1.25rem; list-style: decimal`        |
| `li`             | `margin: 0.125rem 0`                                                    |
| `h1`–`h6`        | `font-weight: 600; line-height: 1.3; margin: 0.5rem 0 0.25rem`; font sizes step from `1.125rem` (h1) down to `1rem` (h3); h4–h6 inherit h3 size |
| `strong`         | `font-weight: 600`                                                      |
| `em`             | `font-style: italic`                                                    |
| `a`              | `text-decoration: underline`                                            |
| `code` (inline)  | `font-family: ui-monospace, monospace; font-size: 0.875em; background: rgb(0 0 0 / 0.06); padding: 0.0625rem 0.25rem; border-radius: 0.25rem` |
| `pre`            | `background: rgb(0 0 0 / 0.06); padding: 0.5rem 0.75rem; border-radius: 0.5rem; overflow-x: auto; margin: 0.5rem 0` |
| `pre code`       | Resets `background` and `padding` so block-code doesn't double-apply the inline-code tint |
| `blockquote`     | `border-left: 3px solid currentColor; opacity: 0.85; padding-left: 0.75rem; margin: 0.5rem 0` |
| `hr`             | `border: none; border-top: 1px solid currentColor; opacity: 0.2; margin: 0.5rem 0` |
| `table`          | `border-collapse: collapse; margin: 0.5rem 0`                           |
| `th`, `td`       | `border: 1px solid currentColor; padding: 0.25rem 0.5rem`              |

## 12.5 Usage example

```svelte
<script lang="ts">
  import { Markdown } from '@salt/ui-components';
</script>

<Markdown text={assistantReply} class="text-sm" />
```

## 12.6 Testing requirements

- Renders plain text without wrapping it in extra elements.
- GFM features (tables, strikethrough) are parsed and rendered (not passed through as raw text).
- The `class` prop is merged onto the wrapper `<div>` alongside `salt-md`.
- The component does **not** expose event handlers or interactive behaviour — it is display-only.
