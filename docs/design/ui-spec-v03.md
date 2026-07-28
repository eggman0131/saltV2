# Salt 2.0 — UI Primitives Specification (v0.3.2, Draft for Planning)

**Status:** Planning  
**Scope:** `@salt/ui-components` — new primitives only  
**Audience:** AI code-generation agents (Claude) + human contributors

> Rule: If anything is missing or ambiguous → STOP → extend this spec → regenerate.  
> No invention beyond what is written here.

---

## 0. v0.3 Scope

v0.3 introduces **advanced APG-based primitives**:

- `RadioGroup` (compound)
- `Select` (compound)
- `Slider` (single + range)
- `Sheet` (compound, directional dialog)
- `Toast` (provider + queue)

**Combobox is explicitly deferred to v0.4.**  
Do not implement Combobox in v0.3.

All global rules, architecture, styling, and testing conventions from **v0.2** remain in force.

---

## 1. Shared v0.3 Rules

### 1.1 Headless + Styled

Each v0.3 primitive has:

- Headless: `src/headless/<Primitive>.headless.svelte.ts`
  - Contains state, ARIA, keyboard, focus, context
  - No Tailwind, no visual styling
- Styled: `src/primitives/<Primitive>/<Primitive>.svelte` (+ parts)
  - Contains Tailwind, CVA, tokens, snippets
  - Imports headless state/context

### 1.2 APG Compliance

Each primitive maps to a **specific WAI‑ARIA Authoring Practices (APG 1.2)** pattern:

- RadioGroup → **APG Radio Group**
- Select → **APG Listbox**
- Slider → **APG Slider**
- Sheet → **APG Dialog**
- Toast → **APG Alert / Status / Live Region**

For each primitive below, APG requirements are **embedded explicitly** and must be implemented exactly.

---

## 2. RadioGroup

### 2.1 Purpose

Mutually exclusive selection from a set of options.  
APG pattern: **Radio Group**.

### 2.2 Parts

- `RadioGroup.svelte` (Root)
- `RadioGroupItem.svelte`

### 2.3 Root Props

- `value: string | undefined` — bindable, controlled value
- `defaultValue: string | undefined` — uncontrolled initial value
- `name: string` — shared native name (generated if not provided)
- `orientation: 'horizontal' | 'vertical' = 'vertical'` — arrow axis
- `disabled: boolean = false` — disables all items
- `required: boolean = false`
- `label: string` — required, visible group label
- `description?: string` — helper text
- `error?: string` — error text
- `class?: string` — merged last

### 2.4 Item Props

- `value: string` — required
- `label?: string` — visible label
- `disabled?: boolean = false`
- `class?: string`

### 2.5 Events

- `onValueChange: (value: string) => void` — fires when selection changes

### 2.6 APG Requirements (Radio Group)

- Root:
  - `role="radiogroup"`
  - Label via `<legend>` or `aria-labelledby`
  - Description via `aria-describedby` (includes error if present)
- Items:
  - `role="radio"`
  - `aria-checked="true"` on selected item, `"false"` otherwise
  - Only **one** item has `tabindex="0"` (selected or first); others `tabindex="-1"`
- Keyboard:
  - `ArrowRight` / `ArrowDown` → move to next item
  - `ArrowLeft` / `ArrowUp` → move to previous item
  - `Home` → first item
  - `End` → last item
  - `Space` → select focused item
  - Disabled items are skipped during navigation

### 2.7 Behavior

- Roving tabindex implemented in headless layer
- Controlled/uncontrolled pattern:
  - If `value` is provided → controlled
  - Else use internal state initialized from `defaultValue`
- `disabled` on root disables all items (no focus, no selection changes)
- `required` is advisory; no built-in validation

---

## 3. Select

### 3.1 Purpose

Custom select using APG **Listbox** pattern with trigger + popup.  
Not a native `<select>`.

### 3.2 Parts

- `Select.svelte` (Root)
- `SelectTrigger.svelte`
- `SelectContent.svelte`
- `SelectItem.svelte`
- `SelectGroup.svelte`
- `SelectLabel.svelte`
- `SelectSeparator.svelte`

### 3.3 Root Props

- `value: string | undefined` — bindable
- `defaultValue: string | undefined`
- `open: boolean` — bindable
- `defaultOpen: boolean`
- `disabled: boolean = false`
- `required: boolean = false`
- `name?: string` — hidden input for forms
- `placeholder?: string` — shown when no value
- `portal: HTMLElement | string | false = "body"`
- `class?: string`

### 3.4 SelectTrigger Props

`SelectTriggerProps` is an open interface that extends `Omit<HTMLButtonAttributes, 'class'>`.

- `class?: string`
- `children?: Snippet`
- Any attribute valid on `<button>` is accepted and spread onto the underlying `<button>` element (e.g. `data-*`, `aria-*`, `tabindex`). The component owns `role`, `aria-haspopup`, `aria-expanded`, and `aria-controls` — passing these manually will be overwritten.

### 3.5 Events

- `onValueChange: (value: string) => void`
- `onOpenChange: (open: boolean) => void`

### 3.6 APG Requirements (Listbox)

- Trigger:
  - `role="button"`
  - `aria-haspopup="listbox"`
  - `aria-expanded={open}`
  - `aria-controls` referencing listbox id when open
- Content:
  - `role="listbox"`
  - `tabindex="-1"`
  - Label via `aria-labelledby` (from external label or trigger)
- Items:
  - `role="option"`
  - `aria-selected="true"` on selected item
- Keyboard (when listbox open):
  - `ArrowDown` / `ArrowUp` → move active option
  - `Home` / `End` → first/last option
  - `Enter` / `Space` → select active option, close listbox, return focus to trigger
  - `Escape` → close listbox, return focus to trigger
  - **Typeahead**:
    - Typing characters moves active option to the next item whose label starts with the typed string (case-insensitive)
    - Typeahead buffer resets after a short timeout (~1s)

### 3.7 Behavior

- Opening:
  - Trigger click or `Space`/`Enter` toggles `open`
  - On open, focus moves into listbox:
    - To selected item if present
    - Else to first item
- Closing:
  - On selection, `open = false`, focus returns to trigger
  - On `Escape`, `open = false`, focus returns to trigger
- Controlled/uncontrolled:
  - `value` vs `defaultValue` as in v0.2 pattern
  - `open` vs `defaultOpen` as in v0.2 pattern
- Hidden input:
  - If `name` provided, render `<input type="hidden" name={name} value={value ?? ''}>`

---

## 4. Slider

### 4.1 Purpose

Continuous numeric input, single or range.  
APG pattern: **Slider**.

### 4.2 Parts

- `Slider.svelte` (Root)
- `SliderTrack.svelte`
- `SliderRange.svelte`
- `SliderThumb.svelte`

### 4.3 Props

- `value: number | [number, number]` — bindable
- `defaultValue: number | [number, number]`
- `min: number = 0`
- `max: number = 100`
- `step: number = 1`
- `orientation: 'horizontal' | 'vertical' = 'horizontal'`
- `disabled: boolean = false`
- `class?: string`

### 4.4 Events

- `onValueChange: (value: number | [number, number]) => void`

### 4.5 APG Requirements (Slider)

- Each thumb:
  - `role="slider"`
  - `tabindex="0"` for active thumb, `-1` for others
  - `aria-valuemin={min}`
  - `aria-valuemax={max}`
  - `aria-valuenow={currentValue}`
  - Optional `aria-valuetext` (not required in v0.3)
- Keyboard:
  - `ArrowRight` / `ArrowUp` → increase by `step`
  - `ArrowLeft` / `ArrowDown` → decrease by `step`
  - `PageUp` → increase by larger step (e.g. `step * 10`)
  - `PageDown` → decrease by larger step
  - `Home` → set to `min`
  - `End` → set to `max`

### 4.6 Behavior

- Single slider:
  - One thumb, one value
- Range slider:
  - Two thumbs, `[minValue, maxValue]`
  - Thumbs cannot cross; enforce `value[0] <= value[1]`
  - Keyboard focus moves between thumbs via pointer or programmatic focus
- Track + range:
  - `SliderTrack` renders full track
  - `SliderRange` renders filled portion between min and value (or between two values)
- Orientation:
  - Horizontal: left→right
  - Vertical: bottom→top

---

## 5. Sheet

### 5.1 Purpose

Side-mounted modal drawer.  
APG pattern: **Dialog** (non-modal variant is out of scope; Sheet is modal).

### 5.2 Parts

- `Sheet.svelte` (Root)
- `SheetTrigger.svelte`
- `SheetContent.svelte`
- `SheetHeader.svelte`
- `SheetTitle.svelte`
- `SheetDescription.svelte`
- `SheetFooter.svelte`
- `SheetClose.svelte`

### 5.3 Root Props

- `open: boolean` — bindable
- `defaultOpen: boolean`
- `side: 'left' | 'right' | 'top' | 'bottom' = 'right'`
- `portal: HTMLElement | string | false = "body"`
- `class?: string`

### 5.3.1 Part props (`SheetPartProps`)

Every non-root part (`SheetTrigger`, `SheetContent`, `SheetHeader`, `SheetTitle`, `SheetDescription`, `SheetFooter`, `SheetClose`) takes the same shape:

- `class?: string` — forwarded to that part's own root element
- `children?: Snippet`

`SheetTrigger`'s `class` in particular is load-bearing, not cosmetic: the trigger is the element the layout constrains, so a caller that needs it sized or stretched has no other handle. `BottomNav`'s overflow ("More") tab is a `SheetTrigger` rather than an `<a>`, and ui-spec-v04 §13.2 requires **every** tab column's interactive element to be `flex flex-1` — a trigger that swallowed `class` could not satisfy that.

### 5.4 Events

- `onOpenChange: (open: boolean) => void`

### 5.5 APG Requirements (Dialog)

- Content:
  - `role="dialog"`
  - `aria-modal="true"`
  - `aria-labelledby` referencing title
  - `aria-describedby` referencing description (if present)
- Focus:
  - On open: move focus to first focusable element or element marked `data-autofocus`
  - Trap focus within content while open
  - On close: restore focus to trigger
- Keyboard:
  - `Escape` closes

### 5.6 Behavior

- Same semantics as Dialog, but:
  - Positioned at side based on `side` prop
  - Animated slide-in/out (respecting reduced motion)
- Trigger:
  - Click or `Space`/`Enter` toggles `open`

---

## 6. Toast

### 6.1 Purpose

Transient, non-modal notifications.  
APG pattern: **Alert / Status / Live Region**.

### 6.2 Parts

- `ToastProvider.svelte`
- `ToastViewport.svelte`
- `Toast.svelte` (Root)
- `ToastTitle.svelte`
- `ToastDescription.svelte`
- `ToastAction.svelte`
- `ToastClose.svelte`

### 6.3 Root Props

- `open: boolean` — bindable
- `defaultOpen: boolean`
- `duration: number = 5000` — ms before auto-dismiss
- `variant: 'default' | 'destructive' = 'default'`
- `class?: string`
- `showCountdown: boolean = false` — opt-in countdown ring (see §6.7)

### 6.4 Provider Behavior

- Manages queue of toasts
- Ensures:
  - Max concurrent toasts (e.g. 3–5)
  - Auto-dismiss after `duration`
  - Pause auto-dismiss on hover
  - Swipe to dismiss (horizontal drag)
- Provides context for viewport position and stacking

### 6.5 APG Requirements (Alert / Live Region)

- Toast root:
  - For `variant="default"`:
    - `role="status"` or `aria-live="polite"`
  - For `variant="destructive"`:
    - `role="alert"` or `aria-live="assertive"`
- Toasts must:
  - Not steal focus
  - Be announced by screen readers when they appear
- Action:
  - `ToastAction` must be a focusable element (e.g. `<button>`)

### 6.6 Undo-able toast (app-level `action` / `onDismiss`)

The `Toast` / `ToastAction` parts above are the primitives. The **undo-able toast** is an app-level composition over them, driven by the web-pwa `toastStore` (`addToast(message, variant, options)`), used by the deferred-delete pattern (ui-spec-v04 §9.3.3). Two options matter:

- **`action: { label, onClick }`** — renders a `ToastAction` button (e.g. "Undo"). Pressing it runs `onClick` and dismisses the toast.
- **`onDismiss()`** — called when the toast closes via **timeout or the close button**, but **not** when the action button is pressed. This is what lets a caller defer work (commit a delete) only if the user _let the toast lapse_ rather than undoing.

```ts
addToast('3 items deleted', 'default', {
  action: { label: 'Undo', onClick: () => unhide(ids) }, // pressed → no commit
  onDismiss: () => commit(ids), // lapsed → commit
});
```

The store lives in the app (`apps/web-pwa/src/lib/toastStore.ts`) and is wired into `ToastViewport` in `App.svelte`; `@salt/ui-components` owns only the `Toast`/`ToastAction` primitives. Relocating the store into the design system remains possible but is intentionally deferred.

### 6.7 Countdown ring (`showCountdown`)

`Toast` accepts an optional **`showCountdown: boolean = false`** prop. When `true` **and** `duration > 0`, the toast renders a small **circular ring that drains from full to empty over `duration`**, making the auto-dismiss window visible. It is the affordance the deferred-delete "Undo" snackbar uses: the ring drains, then the delete commits (see the deferred-delete pattern, ui-spec-v04 §9.3.3). Default off, so every existing toast is visually unchanged; `App.svelte` turns it on for exactly the toasts that carry an `action` (i.e. the undo snackbars).

Behaviour:

- **Drain is CSS-driven** — a linear animation over `duration` on an SVG stroke (`pathLength="1"`), coloured by `currentColor` (no new tokens). It is kept **out of flex flow** (absolute, leading) so the message/action `justify-between` layout is byte-identical to a ring-less toast; the root opens a left gutter (`pl-12`) only when the ring shows.
- **Pauses in lock-step with the dismiss timer** on hover. The same `pause`/`resume` that hold the auto-dismiss timer flip the ring's `animation-play-state`, so a paused timer shows a frozen ring — the visible drain always matches the real remaining time.
- **Reduced motion:** under `prefers-reduced-motion: reduce` the ring is hidden (`motion-reduce:hidden`) — no visible drain. The auto-dismiss timer and the Undo action still work; only the animation is suppressed.
- **Decorative:** the ring is `aria-hidden` and adds nothing to the live region.

---

## 7. Testing Requirements (v0.3)

For each v0.3 primitive, tests must include:

- APG-specific assertions:
  - Correct roles
  - Correct ARIA attributes
  - Correct keyboard behavior per APG
  - Correct focus movement
- For Select:
  - Typeahead behavior
  - Focus return to trigger
- For Slider:
  - Keyboard adjustments
  - Range constraints
- For Sheet:
  - Focus trap
  - Focus restoration
- For Toast:
  - Live region behavior (role / aria-live)
  - Auto-dismiss + pause-on-hover

---

## 8. Generator Instructions (Claude)

When generating v0.3 primitives:

1. **Do not invent props, events, or parts** beyond those listed here.
2. **Implement APG requirements exactly** as specified per primitive.
3. **Use the existing v0.2 architecture**:
   - headless `.headless.svelte.ts`
   - styled `.svelte` + parts
   - CVA variants
   - Tailwind tokens
4. **If a behavior is not specified here or in v0.2**:
   - STOP and request a spec extension.
5. **Do not implement Combobox** in v0.3.

---

## 9. Changelog

Amendments follow the v0.2 procedure (ui-spec-v02 §1.5): bump the version in this doc's header, add a line here, and re-stamp the affected primitive's provenance line.

| Date       | Version | Summary                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-28 | v0.3.2  | §5.3.1 Sheet: recorded the shared `SheetPartProps` shape (`class?`, `children?`) carried by every non-root part, and why `SheetTrigger`'s `class` is load-bearing rather than cosmetic — `BottomNav`'s overflow ("More") tab is a `SheetTrigger`, and ui-spec-v04 §13.2 requires every tab column's interactive element to be `flex flex-1`. Ratifies the `class` prop shipped in #605. Re-stamped `SheetTrigger.svelte` provenance (the only part whose contract changed; `SheetPartProps` itself is unchanged). Resolves part of doc/code drift issue #608. |
| 2026-07-23 | v0.3.1  | §6.3/§6.7 Toast: added opt-in `showCountdown` prop — a circular ring that drains over `duration`, pauses with the dismiss timer on hover, hidden under reduced motion. Drives the deferred-delete "Undo" snackbar's visible window. No colour/anchoring change. Re-stamped `Toast.svelte` + `Toast.types.ts` provenance to v0.3.1 (the parts whose contract changed). |

---
