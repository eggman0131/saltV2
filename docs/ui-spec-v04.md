# Salt 2.0 — UI Primitives Specification (v0.4)
**Status:** Planning  
**Scope:** `@salt/ui-components` — Combobox  
**Audience:** AI code-generation agents + human contributors  

> Rule: If anything is missing or ambiguous → STOP → extend this spec → regenerate.  
> No invention beyond what is written here.

This document extends **v0.2** and **v0.3**.  
All global rules, architecture, naming, styling, and testing conventions from v0.2 remain in force.

---

## 0. v0.4 Scope

v0.4 introduces **Combobox**:

- `Combobox` — text input + popup listbox + filtering + optional custom values

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

| Name           | Type                                  | Default     | Notes                                      |
|----------------|---------------------------------------|-------------|--------------------------------------------|
| `value`        | string \| undefined (bindable)        | undefined   | Selected value                             |
| `defaultValue` | string \| undefined                   | undefined   | Uncontrolled initial value                 |
| `open`         | boolean (bindable)                    | false       | Popup open state                           |
| `defaultOpen`  | boolean                               | false       | Initial open state                         |
| `items`        | Array<{ value: string; label: string }> | []        | Full option list                           |
| `allowCustom`  | boolean                               | false       | Allow values not in `items`                |
| `restrict`     | boolean                               | false       | If true, must select from `items`          |
| `name`         | string \| undefined                   | —           | Hidden input name                          |
| `placeholder`  | string \| undefined                   | —           | Input placeholder                          |
| `portal`       | HTMLElement \| string \| false        | "body"      | Portal target for content                  |
| `filterFn`     | (input: string, item: { value; label }) => boolean | default filter | Optional custom filter function |
| `class`        | string \| undefined                   | —           | Root class                                 |

> `allowCustom` and `restrict` are mutually exclusive.  
> If both are true → **STOP** and throw in dev.

### 3.2 Events

- `onValueChange: (value: string) => void`
- `onOpenChange: (open: boolean) => void`
- `onCreate?: (value: string) => void` — fired when a new custom value is created (only if `allowCustom`)

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

