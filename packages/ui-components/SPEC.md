# Salt 2.0 — UI Primitives Specification (v0.2.3)

**Status:** Authoritative
**Audience:** AI code generators + human contributors
**Rule:** If anything is missing → STOP → extend spec → regenerate. No invention.

Every generated file MUST begin with a provenance header (see §3.8). If you cannot cite a section for a decision, you are inventing — stop and amend the spec first.

---

# 0. Roadmap Split

## v0.2 Core (implemented now)
- Button
- TextField
- Textarea
- Checkbox
- Switch
- Dialog
- Popover
- Tooltip
- Card
- Heading
- Text
- Icon
- Stack
- Inline
- Grid
- Divider
- Spinner
- Progress

## v0.3 Advanced (NOT implemented in v0.2)
- RadioGroup
- Select
- Slider
- Sheet
- Toast

Generators must not implement v0.3 primitives until the v0.3 spec exists.

---

# 1. Foundations

## 1.1 Technology Stack
| Concern | Technology |
|--------|------------|
| Framework | Svelte 5 `^5.55.0` (runes: `$state`, `$derived`, `$effect`, `$props`, `$bindable`) |
| Styling | Tailwind CSS + shadcn token scheme |
| Animations | tailwindcss-animate (registered by preset — see §3.3) |
| Headless | bits-ui ≥ 1.0.0; melt-ui ≥ 1.0.0-svelte5 (fallback only) |
| Variants | class-variance-authority (CVA) |
| Class merging | tailwind-merge + clsx via `cn()` |
| Icons | lucide-svelte (typed as `keyof typeof import('lucide-svelte')`) |
| Testing | Vitest + @testing-library/svelte + user-event + axe-core |
| TS | strict: true |

---

## 1.2 Boundaries
`@salt/ui-components` is a leaf package (external-only — no `@salt/*` imports).

Allowed imports:
- bits-ui, melt-ui, lucide-svelte
- Svelte internals
- Tailwind utilities

Forbidden:
- All Salt app/domain packages (`@salt/domain`, `@salt/firebase-adapter`, `@salt/web-pwa`, `@salt/cloud-functions`)
- Firebase SDKs
- Node built-ins
- Browser APIs except inside Svelte actions or `$effect` blocks

Consumers may NOT import bits-ui / melt-ui / lucide-svelte directly. All access is through `@salt/ui-components` entry points.

---

## 1.3 Package Surface

Entry points (exact):

| Import path | Contents |
|-------------|----------|
| `@salt/ui-components` | Stable primitive components + re-exports of tokens + `cn` + `useId` |
| `@salt/ui-components/headless` | `create<Primitive>State()` factories + context keys |
| `@salt/ui-components/tokens` | TS token constants (generated from Tailwind preset) |
| `@salt/ui-components/tailwind-preset` | Tailwind preset object (default export) |
| `@salt/ui-components/test` | Test helpers (internal only — not for app consumption) |

**Barrel shape (`src/index.ts`):**
```ts
// Primitives
export { default as Button } from './primitives/Button/Button.svelte';
export { default as TextField } from './primitives/TextField/TextField.svelte';
// ... one line per primitive, alphabetical

// Compound parts
export { default as DialogTrigger } from './primitives/Dialog/DialogTrigger.svelte';
// ... explicit re-exports for every sub-part

// Helpers (re-exported from ./lib)
export { cn } from './lib/cn';
export { useId } from './lib/useId';

// Token re-exports
export * as tokens from './tokens';

// Types
export type { ButtonProps } from './primitives/Button/Button.types';
// ... one per primitive
```

**Headless barrel (`src/headless.ts`):**
```ts
export { createDialogState, DIALOG_CONTEXT } from './headless/Dialog.headless.svelte';
export { createPopoverState, POPOVER_CONTEXT } from './headless/Popover.headless.svelte';
// ... only primitives with a headless layer
```

**Tokens barrel (`src/tokens.ts`):** default export of the preset object plus named exports of token groups (`colors`, `radius`, `motion`, `elevation`, `zIndex`). Content is generated from the Tailwind preset — never hand-edited.

**Test barrel (`src/test.ts`):** `renderPrimitive`, `axeCheck`, `pressKey` helpers. Not listed in package `exports` for app consumers — only for internal tests.

No deep imports. No side-effect imports in any barrel.

---

## 1.4 Event Naming Rule

**Native DOM events:** lowercase, matching the underlying element's attribute name. Examples: `onclick`, `oninput`, `onfocus`, `onblur`, `onkeydown`. Types are the native event types (`MouseEvent`, `KeyboardEvent`, etc.). These are passed through via `$props()` spread or explicit forwarding — never wrapped.

**Custom callbacks:** camelCase starting with `on<Verb>`. Examples: `onValueChange`, `onCheckedChange`, `onOpenChange`. Signature is `(value: T) => void` — single positional argument of the new state, never an event object. These are invoked directly (no `createEventDispatcher`).

**Bindable state + callback:** a primitive that bindings a state variable MUST also expose the matching `on<Verb>Change` callback. Both fire on every change. The pattern is documented in §3.6.

---

## 1.5 Spec Versioning & Amendment Rule

The spec is versioned `vMAJOR.MINOR.PATCH` (currently v0.2.1).

- **PATCH** (v0.2.1 → v0.2.2): clarifications, typo fixes, tightened class matrices. No breaking change to generated code.
- **MINOR** (v0.2.x → v0.3.0): new primitives, new props, new tokens.
- **MAJOR** (v0.x → v1.0): breaking changes to existing primitives.

When you amend this spec:
1. Bump the version in the header.
2. Add a line to §9 Changelog with date, version, and summary.
3. If the amendment changes a primitive contract, update that primitive's `Provenance` line so existing generated files can be diffed against the new contract.

---

# 2. Design Principles

## 2.1 Architecture
Every non-trivial primitive has two layers, in two different folders:

### Headless layer
- Location: `src/headless/<Primitive>.headless.svelte.ts` (centralized — NOT co-located with the styled component).
- Contains: state, ARIA wiring, keyboard handling, focus management, context keys.
- No styling, no Tailwind, no class names.
- Exposes: `create<Primitive>State(options)` factory + a `<PRIMITIVE>_CONTEXT` symbol.

### Styled layer
- Location: `src/primitives/<Primitive>/<Primitive>.svelte` (co-located with parts, variants, types).
- Contains: Tailwind classes, CVA variants, token references, snippet composition.
- Imports headless layer via relative path.
- No behavior duplication — styled layer is presentation only.

**Trivial primitives** (pure layout/visual, no state or a11y logic) may skip the headless layer. The v0.2 primitives that skip headless are: Card, Heading, Text, Icon, Stack, Inline, Grid, Divider, Spinner.

---

## 2.2 Accessibility
All interactive primitives must:
- Follow WAI-ARIA APG 1.2.
- Support full keyboard interaction (see §5.2).
- Provide programmatic labels (`aria-label`, `aria-labelledby`, or `<label for>`).
- Pass axe-core with zero serious/critical violations.
- Provide a deterministic focus ring (see §4.2).
- Support reduced motion (`motion-reduce:` variants) and forced-colors mode.

---

## 2.3 Styling Rules
- Tailwind utilities only — no raw CSS files except the preset.
- CVA for multi-axis variants.
- Dark mode via `.dark` class on `<html>` (see §4.5).
- `class` prop merged last via `cn()`.
- No inline `style` attributes except for numeric transforms (`transform: scaleX(...)` on Progress, `transform: translate3d(...)` on Switch thumb, etc.).

---

## 2.4 Naming Conventions
| Item | Convention |
|------|------------|
| Component file | PascalCase `.svelte` |
| Compound part file | PascalCase, `<Parent><Part>.svelte` (e.g., `DialogTrigger.svelte`) |
| Headless file | `<Primitive>.headless.svelte.ts` |
| Variants file | `<Primitive>.variants.ts` |
| Types file | `<Primitive>.types.ts` |
| Props | camelCase |
| Boolean props | affirmative (`disabled`, `loading`, never `notDisabled`) |
| Bindable props | typed with `$bindable()` (e.g., `value`, `open`, `checked`) |
| Events | see §1.4 |
| Snippets | camelCase (`leading`, `trailing`, `default`) |
| CSS vars | `--salt-*` |
| Custom classes | `salt-*` |
| Context symbols | UPPER_SNAKE with `_CONTEXT` suffix |
| `aria-*` translation | camelCase prop (e.g., `ariaLabel`) → kebab attr (`aria-label`) in rendered DOM. Translation is the component's responsibility. |

---

## 2.5 Composition Rules
- Compound primitives use explicit sub-components (`DialogTrigger`, `DialogContent`). No string-based `type` props.
- No DOM traversal upward (`parentNode` walks). Communication is via context keys set by the root.
- Context keys are defined in the headless file and exported from `@salt/ui-components/headless`.
- Portals allowed only for: Dialog, Popover, Tooltip.
- `portal: HTMLElement | string | false` (default `"body"`). String values are treated as CSS selectors.
- Controlled/uncontrolled pattern (canonical wiring in §3.6):
  - `value` — bindable, always reflects the current state.
  - `defaultValue` — initial uncontrolled value; read once, never again.
  - Never pass both for the same state.
  - Every bindable has a matching `on<Verb>Change` callback that fires on every update.

---

## 2.6 Determinism
- No `Math.random()`, no `Date.now()` in render paths.
- No timers outside of `$effect` cleanup (e.g. tooltip delay is fine; a spinner tick is not).
- No `fetch`, no `localStorage`, no `sessionStorage`, no `IndexedDB`.
- `useId()` is a module-scope counter — deterministic within a single client-side render tree, **not SSR-safe**. v0.2 targets client-only rendering; if SSR is introduced, §3.5 must be amended to use a request-scoped id source before any SSR rollout.
- Identical props → identical DOM. Property order must be stable.

---

# 3. Component Architecture

## 3.1 Folder Structure
```
src/
  index.ts                       ← primitive + helper + type barrel
  headless.ts                    ← headless barrel
  tokens.ts                      ← token barrel (generated)
  test.ts                        ← test helpers barrel
  tailwind-preset.ts             ← Tailwind preset default export
  lib/
    cn.ts                        ← see §3.5
    useId.ts                     ← see §3.5
    context.ts                   ← see §3.5
    variants.ts                  ← CVA helpers, VariantProps
  tokens/
    colors.ts
    radius.ts
    motion.ts
    elevation.ts
    z-index.ts
  headless/
    Button.headless.svelte.ts
    TextField.headless.svelte.ts
    Checkbox.headless.svelte.ts
    Switch.headless.svelte.ts
    Dialog.headless.svelte.ts
    Popover.headless.svelte.ts
    Tooltip.headless.svelte.ts
    Progress.headless.svelte.ts
    (Textarea reuses TextField.headless)
  primitives/
    <Primitive>/
      <Primitive>.svelte
      <Primitive><Part>.svelte        ← one per compound part
      <Primitive>.variants.ts         ← CVA definitions
      <Primitive>.types.ts            ← exported prop types
      index.ts                        ← local barrel, re-exports .svelte parts + types
tests/
  <Primitive>.test.ts
```

---

## 3.2 Export Rules
- `.svelte` files default-export (compiler behavior).
- Local barrels (`primitives/<Primitive>/index.ts`) re-export via:
  ```ts
  export { default as Button } from './Button.svelte';
  export type { ButtonProps } from './Button.types';
  ```
- `.ts` files have no default exports.
- No side-effect imports in any barrel (`src/index.ts`, `src/headless.ts`, etc.).

---

## 3.3 Tailwind + Token Ownership

**`src/tailwind-preset.ts` is the single source of truth for design tokens.**

`src/tokens/*.ts` and `src/tokens.ts` are generated from the preset by `scripts/generate-tokens.ts` and checked in. Regeneration is idempotent. Do not hand-edit files under `src/tokens/`.

The preset exports CSS variables on `:root` and `.dark`, plus Tailwind theme extensions that reference them:

```ts
// src/tailwind-preset.ts (shape, not full content)
export default {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--salt-background) / <alpha-value>)',
        foreground: 'hsl(var(--salt-foreground) / <alpha-value>)',
        // ... every semantic color from §4.1
      },
      borderRadius: { /* from §4.1 */ },
      transitionDuration: { /* from §4.1 */ },
      transitionTimingFunction: { /* from §4.1 */ },
      boxShadow: { /* from §4.1 */ },
      zIndex: { /* from §4.1 */ },
    },
  },
  plugins: [
    // salt-focus-ring utility (§4.2)
    // base layer: CSS vars on :root and .dark
  ],
};
```

Apps must import the preset:
```ts
import salt from '@salt/ui-components/tailwind-preset';
export default { presets: [salt], content: [/* app globs */] };
```

The preset registers `tailwindcss-animate` as a plugin so `animate-in` / `animate-out` / `data-[state=open]:*` animation utilities are available to all consumers without per-app configuration.

---

## 3.4 bits-ui / melt-ui Versions
- bits-ui ≥ 1.0.0 (Svelte 5 support).
- melt-ui ≥ 1.0.0-svelte5.
- melt-ui only when bits-ui lacks the primitive.
- Version pins live in root `package.json` — not in the preset.

---

## 3.5 Helpers

### `src/lib/cn.ts`
```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

### `src/lib/useId.ts`
```ts
let counter = 0;
export function useId(prefix = 'salt'): string {
  // SSR-stable: counter resets per render via Svelte's module scope.
  // Do not rely on randomness.
  return `${prefix}-${++counter}`;
}
```
IDs generated at component construction, stored in `$state`, stable for the component's lifetime.

### `src/lib/context.ts`
```ts
import { getContext, setContext } from 'svelte';

export function createContext<T>(name: string) {
  const key = Symbol(name);
  return {
    set: (value: T) => setContext(key, value),
    get: (): T => {
      const value = getContext<T>(key);
      if (value === undefined) {
        throw new Error(`${name} context not found. Wrap in the matching root component.`);
      }
      return value;
    },
    key,
  };
}
```

Context objects are exported from each headless file as a named constant (e.g., `DIALOG_CONTEXT = createContext<DialogState>('Dialog')`).

### `src/lib/variants.ts`
```ts
export { cva, type VariantProps } from 'class-variance-authority';
```
Re-export only. No wrapper; CVA is used directly in each `<Primitive>.variants.ts`.

---

## 3.6 Canonical Patterns — Button Worked Example

This is the copy-source for every other primitive. Deviation requires a spec amendment.

### `src/headless/Button.headless.svelte.ts`
```ts
// spec: SPEC.md §8.1 v0.2.1
export type ButtonState = {
  readonly loading: boolean;
  readonly disabled: boolean;
  readonly interactive: boolean; // !disabled && !loading
};

export function createButtonState(opts: {
  disabled: () => boolean;
  loading: () => boolean;
}): ButtonState {
  return {
    get loading() { return opts.loading(); },
    get disabled() { return opts.disabled(); },
    get interactive() { return !opts.disabled() && !opts.loading(); },
  };
}
```

### `src/primitives/Button/Button.variants.ts`
```ts
// spec: SPEC.md §8.1 v0.2.1
import { cva, type VariantProps } from '../../lib/variants';

export const buttonVariants = cva(
  'salt-focus-ring inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors motion-reduce:transition-none disabled:pointer-events-none data-[disabled]:opacity-50',
  {
    variants: {
      variant: {
        solid: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'bg-transparent hover:bg-muted hover:text-foreground',
        link: 'bg-transparent underline-offset-4 hover:underline text-primary',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-4 text-sm',
        lg: 'h-10 px-6 text-base',
        icon: 'h-9 w-9 p-0',
      },
      fullWidth: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'solid', size: 'md', fullWidth: false },
  }
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;
```

### `src/primitives/Button/Button.types.ts`
```ts
// spec: SPEC.md §8.1 v0.2.1
import type { Snippet } from 'svelte';
import type { HTMLButtonAttributes } from 'svelte/elements';
import type { ButtonVariants } from './Button.variants';

export type ButtonProps = {
  variant?: ButtonVariants['variant'];
  size?: ButtonVariants['size'];
  fullWidth?: boolean;
  loading?: boolean;
  ariaLabel?: string;
  class?: string;
  leading?: Snippet;
  trailing?: Snippet;
  children?: Snippet;
  onclick?: HTMLButtonAttributes['onclick'];
} & Omit<HTMLButtonAttributes, 'class' | 'onclick'>;
```

### `src/primitives/Button/Button.svelte`
```svelte
<!-- spec: SPEC.md §8.1 v0.2.1 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { createButtonState } from '../../headless/Button.headless.svelte';
  import { buttonVariants } from './Button.variants';
  import Spinner from '../Spinner/Spinner.svelte';
  import type { ButtonProps } from './Button.types';

  let {
    variant = 'solid',
    size = 'md',
    type = 'button',
    disabled = false,
    loading = false,
    fullWidth = false,
    ariaLabel,
    class: className,
    leading,
    trailing,
    children,
    onclick,
    ...rest
  }: ButtonProps = $props();

  const state = createButtonState({
    disabled: () => disabled,
    loading: () => loading,
  });

  function handleClick(e: MouseEvent) {
    if (!state.interactive) {
      e.preventDefault();
      return;
    }
    onclick?.(e);
  }
</script>

<button
  {type}
  class={cn(buttonVariants({ variant, size, fullWidth }), className)}
  disabled={state.disabled}
  data-disabled={state.disabled ? '' : undefined}
  data-loading={state.loading ? '' : undefined}
  aria-disabled={state.disabled || state.loading ? 'true' : undefined}
  aria-busy={state.loading ? 'true' : undefined}
  aria-label={ariaLabel}
  onclick={handleClick}
  {...rest}
>
  {#if state.loading}
    <Spinner size={16} />
  {:else if leading}
    {@render leading()}
  {/if}

  {@render children?.()}

  {#if !state.loading && trailing}
    {@render trailing()}
  {/if}
</button>
```

### `src/primitives/Button/index.ts`
```ts
export { default as Button } from './Button.svelte';
export type { ButtonProps } from './Button.types';
export { buttonVariants } from './Button.variants';
```

### Canonical controlled/uncontrolled wiring (reference for all bindable primitives)

```svelte
<script lang="ts">
  let {
    value = $bindable(),
    defaultValue = '',
    onValueChange,
  }: { value?: string; defaultValue?: string; onValueChange?: (v: string) => void } = $props();

  // If `value` is undefined (uncontrolled), seed from defaultValue once.
  if (value === undefined) value = defaultValue;

  function update(next: string) {
    value = next;          // bindable write — triggers consumer binding
    onValueChange?.(next); // callback fires on every change
  }
</script>
```

### Canonical snippet render pattern

```svelte
{#if leading}{@render leading()}{/if}
{@render children?.()}
{#if trailing}{@render trailing()}{/if}
```

Never use `<slot>`. Never call `{@render}` conditionally without an `{#if}` guard on optional snippets.

---

## 3.7 bits-ui Mapping Table

Which v0.2 primitives wrap which bits-ui primitive. **No other mapping is permitted.**

| Salt primitive | bits-ui primitive | Notes |
|----------------|-------------------|-------|
| Button | — | Native `<button>`. No bits-ui. |
| TextField | — | Native `<input>`. No bits-ui. |
| Textarea | — | Native `<textarea>`. No bits-ui. |
| Checkbox | `Checkbox` | Wrap `Checkbox.Root` + `Checkbox.Indicator`. |
| Switch | `Switch` | Wrap `Switch.Root` + `Switch.Thumb`. |
| Dialog | `Dialog` | Wrap `Dialog.Root`, `.Trigger`, `.Portal`, `.Overlay`, `.Content`, `.Title`, `.Description`, `.Close`. |
| Popover | `Popover` | Wrap `Popover.Root`, `.Trigger`, `.Portal`, `.Content`. |
| Tooltip | `Tooltip` | Wrap `Tooltip.Provider`, `.Root`, `.Trigger`, `.Portal`, `.Content`. |
| Card | — | Pure styled `<div>`s. |
| Heading, Text, Icon | — | Pure styled elements. |
| Stack, Inline, Grid, Divider | — | Pure styled `<div>`s. |
| Spinner | — | Inline SVG. |
| Progress | `Progress` | Wrap `Progress.Root` + `Progress.Indicator`. |

Portal implementation uses bits-ui's built-in `.Portal` part for Dialog, Popover, Tooltip. Do not implement a custom portal.

---

## 3.8 Provenance Header Convention

**Every generated file under `src/headless/**`, `src/primitives/**`, and `src/lib/**` MUST begin with a provenance header on the first non-blank line:**

- `.svelte` files: `<!-- spec: SPEC.md §X.Y vM.m.p -->`
- `.ts` / `.svelte.ts` files: `// spec: SPEC.md §X.Y vM.m.p`

Where `§X.Y` is the most specific spec section the file implements and `vM.m.p` is the spec version that was current when the file was generated or last amended.

Files without a provenance header fail CI. Files whose header version is older than the current spec and whose referenced section has changed must be regenerated or manually reconciled and re-stamped.

---

# 4. Styling System

## 4.1 Tokens

Salt adopts the shadcn token scheme, emitted as CSS variables on `:root` and `.dark` by the Tailwind preset.

### Semantic colors
- `background`, `foreground`
- `primary`, `primary-foreground`
- `secondary`, `secondary-foreground`
- `muted`, `muted-foreground`
- `accent`, `accent-foreground`
- `destructive`, `destructive-foreground`
- `card`, `card-foreground`
- `popover`, `popover-foreground`
- `border`, `input`, `ring`

### Radius
- `rounded-sm` → `--salt-radius-sm` (2px)
- `rounded-md` → `--salt-radius-md` (6px)
- `rounded-lg` → `--salt-radius-lg` (10px)
- `rounded-xl` → `--salt-radius-xl` (14px)
- `rounded-full` → `9999px`

### Motion
- `duration-fast` (120ms)
- `duration-base` (180ms)
- `duration-slow` (260ms)
- `ease-standard` (`cubic-bezier(0.2, 0, 0, 1)`)
- `ease-emphasized` (`cubic-bezier(0.3, 0, 0, 1)`)
- `ease-decel` (`cubic-bezier(0, 0, 0, 1)`)

### Elevation
- `shadow-sm`, `shadow-md`, `shadow-lg`
- `shadow-popover` (same as shadow-md)
- `shadow-dialog` (same as shadow-lg)

### Z-index
- `z-popover` → 40
- `z-dialog` → 50
- `z-tooltip` → 70

---

## 4.2 Focus Ring

Utility class: `salt-focus-ring` (registered by preset plugin).

Expands to:
```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
```

Applied to every interactive primitive's visible focus target. Never use `focus:` without `-visible`.

---

## 4.3 Disabled + Loading

### Disabled (terminal state — no interaction)
- Attribute: `data-disabled=""`
- ARIA: `aria-disabled="true"`
- Native `disabled` attribute on form controls
- Classes: `opacity-50 pointer-events-none`

### Loading (transient state — disables interaction without terminal semantics)
- Attribute: `data-loading=""`
- ARIA: `aria-busy="true"` + `aria-disabled="true"`
- Click handlers call `preventDefault()` when loading
- Form controls set `disabled={true}` while loading

Both states can coexist visually but `data-disabled` takes precedence for opacity.

---

## 4.4 Shared Size Scale

Sized primitives use one of these scales. Deviation requires a spec amendment.

### Field Size Scale (TextField, Textarea frame, Button)
| size | height | x-padding | text |
|------|--------|-----------|------|
| `sm` | `h-8` | `px-3` | `text-sm` |
| `md` | `h-9` | `px-4` | `text-sm` |
| `lg` | `h-10` | `px-6` | `text-base` |

### Control Size Scale (Checkbox, Switch)
| size | Checkbox box | Switch track | Switch thumb |
|------|--------------|--------------|--------------|
| `sm` | `h-3.5 w-3.5` | `h-4 w-7` | `h-3 w-3` |
| `md` | `h-4 w-4` | `h-5 w-9` | `h-4 w-4` |
| `lg` | `h-5 w-5` | `h-6 w-11` | `h-5 w-5` |

### Dialog Size Scale
| size | max-width |
|------|-----------|
| `sm` | `max-w-sm` |
| `md` | `max-w-md` |
| `lg` | `max-w-2xl` |
| `xl` | `max-w-4xl` |
| `full` | `max-w-[calc(100vw-2rem)]` |

### Text Size Scale (Text primitive)
| size | class |
|------|-------|
| `sm` | `text-sm` |
| `md` | `text-base` |
| `lg` | `text-lg` |

### Icon / Spinner sizes
Numeric `number` prop, mapping directly to SVG `width`/`height` in pixels. Default 16. This is intentionally different from the string scale above — icons and spinners are content-sized, not layout-sized.

---

## 4.5 Dark Mode

- Tailwind config uses `darkMode: 'class'`.
- Apps toggle by adding/removing the `dark` class on `<html>`. Salt does not provide a toggle component in v0.2.
- All tokens have `:root` (light) and `.dark` values declared by the preset plugin.
- Primitives never reference dark-mode variants directly — they use semantic tokens that re-resolve under `.dark`.

---

# 5. Accessibility System

## 5.1 Universal Requirements
- Tab-reachable unless using roving tabindex.
- Correct ARIA role on the interactive element.
- ARIA state attributes reflect component state (`aria-checked`, `aria-expanded`, etc.).
- Label association: visible `<label>`, `aria-label`, or `aria-labelledby`.
- Error exposure: `aria-invalid="true"` + `aria-describedby` referencing the error element's id.
- Works at 200% zoom, forced-colors mode, and `prefers-reduced-motion: reduce`.

---

## 5.2 Keyboard Map
- Activation: `Space`, `Enter`
- List navigation: `ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight` + `Home`/`End`
- Dismiss: `Escape`
- Slider (v0.3): arrows, `PageUp`/`PageDown`, `Home`/`End`
- Radio (v0.3): arrows cycle, `Space` selects

---

## 5.3 Focus Management
- Dialog: trap focus inside content, restore to trigger on close.
- Popover: optional focus trap (`trapFocus` prop).
- Tooltip: never takes focus; never steals focus.

---

# 6. Testing System

## 6.1 Required Test Suites

Each primitive must include these `describe` blocks (exact names):

1. `"renders with minimum required props"`
2. `"props contract"`
3. `"events contract"`
4. `"keyboard interaction"`
5. `"accessibility"`
6. `"composition"` — compound primitives only
7. `"controlled vs uncontrolled"` — stateful primitives only

No snapshot tests. No implementation-detail assertions.

---

## 6.2 Test File Template

Every `tests/<Primitive>.test.ts` follows this shape. This is the copy-source.

```ts
// spec: SPEC.md §6 v0.2.1
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import Button from '../src/primitives/Button/Button.svelte';

describe('Button', () => {
  describe('renders with minimum required props', () => {
    it('renders a button with children', () => {
      render(Button, { props: { children: 'Click me' } });
      expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
    });
  });

  describe('props contract', () => {
    it('applies variant classes', () => {
      render(Button, { props: { variant: 'destructive', children: 'Delete' } });
      expect(screen.getByRole('button')).toHaveClass('bg-destructive');
    });
    it('merges class prop last', () => {
      render(Button, { props: { class: 'custom-class', children: 'x' } });
      expect(screen.getByRole('button')).toHaveClass('custom-class');
    });
    it('sets data-disabled when disabled', () => {
      render(Button, { props: { disabled: true, children: 'x' } });
      expect(screen.getByRole('button')).toHaveAttribute('data-disabled', '');
    });
  });

  describe('events contract', () => {
    it('calls onclick when interactive', async () => {
      const onclick = vi.fn();
      render(Button, { props: { onclick, children: 'x' } });
      await userEvent.click(screen.getByRole('button'));
      expect(onclick).toHaveBeenCalledOnce();
    });
    it('suppresses click when loading', async () => {
      const onclick = vi.fn();
      render(Button, { props: { onclick, loading: true, children: 'x' } });
      await userEvent.click(screen.getByRole('button'));
      expect(onclick).not.toHaveBeenCalled();
    });
  });

  describe('keyboard interaction', () => {
    it('activates on Enter', async () => {
      const onclick = vi.fn();
      render(Button, { props: { onclick, children: 'x' } });
      screen.getByRole('button').focus();
      await userEvent.keyboard('{Enter}');
      expect(onclick).toHaveBeenCalled();
    });
  });

  describe('accessibility', () => {
    it('has no axe violations', async () => {
      const { container } = render(Button, { props: { children: 'x' } });
      expect(await axe(container)).toHaveNoViolations();
    });
    it('requires ariaLabel for icon-only', () => {
      render(Button, { props: { size: 'icon', ariaLabel: 'Settings', children: undefined } });
      expect(screen.getByRole('button')).toHaveAccessibleName('Settings');
    });
  });
});
```

Stateful primitives add a `"controlled vs uncontrolled"` block:

```ts
describe('controlled vs uncontrolled', () => {
  it('uses defaultValue when uncontrolled', () => { /* ... */ });
  it('ignores defaultValue when value is provided', () => { /* ... */ });
  it('fires onValueChange and updates binding on change', async () => { /* ... */ });
});
```

Compound primitives add a `"composition"` block that asserts parts render only inside their root and that context is wired.

---

# 7. Primitive Inventory (v0.2 Core)

See §0.

---

# 8. Primitive Definitions (v0.2 Core)

Each primitive section below is the authoritative contract. The canonical implementation pattern is Button (§3.6) — use it as the template for all others.

---

## 8.1 Button

### Purpose
Trigger an action.

### Props
| Name | Type | Default | Notes |
|------|------|---------|-------|
| `variant` | `'solid' \| 'outline' \| 'ghost' \| 'link' \| 'destructive'` | `'solid'` | CVA axis |
| `size` | `'sm' \| 'md' \| 'lg' \| 'icon'` | `'md'` | Field Size Scale + `icon` |
| `type` | `'button' \| 'submit' \| 'reset'` | `'button'` | native |
| `disabled` | `boolean` | `false` | native |
| `loading` | `boolean` | `false` | shows spinner |
| `fullWidth` | `boolean` | `false` | `w-full` |
| `ariaLabel` | `string \| undefined` | — | **required when `size === 'icon'`** |
| `class` | `string \| undefined` | — | merged last |

### Snippets
- `leading`
- `trailing`
- `default` (label / `children`)

### Events
- `onclick: (e: MouseEvent) => void` — native, suppressed while `disabled` or `loading`.

### Accessibility
- Native `<button>`.
- `loading`: `aria-busy="true"`, `aria-disabled="true"`, click suppressed.
- `disabled`: `aria-disabled="true"`, native `disabled`.
- Icon-only (`size === 'icon'`) requires `ariaLabel`.

### Behavior
- Loading replaces the **leading** snippet with a Spinner.
- Label (`children`) remains visible during loading.
- Trailing snippet is hidden during loading.

### Styling (CVA)
See §3.6. This is the canonical reference — all other primitives follow the same shape.

### Forbidden
- Do not wrap bits-ui's `Button` — there isn't one; use native `<button>`.
- Do not emit `onClick` (PascalCase) — it's `onclick`.

---

## 8.2 TextField

### Purpose
Single-line text input with label + description + error.

### Props
| Name | Type | Default |
|------|------|---------|
| `value` | `string` (bindable) | — |
| `defaultValue` | `string` | `''` |
| `label` | `string` | **required** |
| `description` | `string \| undefined` | — |
| `error` | `string \| undefined` | — |
| `type` | `'text' \| 'email' \| 'password' \| 'url' \| 'tel' \| 'search'` | `'text'` |
| `placeholder` | `string \| undefined` | — |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` (Field Size Scale) |
| `disabled` | `boolean` | `false` |
| `readonly` | `boolean` | `false` |
| `required` | `boolean` | `false` |
| `autocomplete` | `string \| undefined` | — |
| `name` | `string \| undefined` | — |
| `id` | `string` | generated via `useId('textfield')` |
| `class` | `string \| undefined` | — |

### Snippets
- `leading`
- `trailing`

### Events
- `onValueChange: (value: string) => void`
- `onfocus`, `onblur` (native pass-through)

### Accessibility
- `<label for={id}>` renders the visible label.
- Description rendered in a `<span id={descId}>`; referenced via `aria-describedby`.
- Error rendered in a `<span id={errorId}>` with `role="alert"`; id **prepended** to `aria-describedby` when present.
- Error presence sets `aria-invalid="true"`.
- `required` sets `aria-required="true"` and the native `required` attribute.

### Styling (CVA)
Frame wraps `<input>` + leading/trailing snippets.
```
frame base: 'salt-focus-ring-within flex items-center gap-2 rounded-md border border-input bg-background'
frame size: sm='h-8 px-3 text-sm' | md='h-9 px-4 text-sm' | lg='h-10 px-6 text-base'
frame error: 'border-destructive focus-within:ring-destructive'
frame disabled: 'opacity-50 pointer-events-none'
input: 'flex-1 bg-transparent outline-none placeholder:text-muted-foreground'
label: 'text-sm font-medium text-foreground'
description: 'text-sm text-muted-foreground'
error text: 'text-sm text-destructive'
```

Focus ring is applied to the **frame** via `focus-within:`, not to the raw `<input>`.

### Error-message rendering
Error element renders **below** the input frame, always has `role="alert"`, is announced on change (live region). Rendered when `error` is a non-empty string — empty string or `undefined` means no error.

### Forbidden
- No custom `type` values beyond the listed set (use v0.3 Select/Slider for number selection, etc.).
- Do not attach focus ring to the `<input>` directly.

---

## 8.3 Textarea

Same contract as TextField except:
- No `type` prop.
- Adds:
  - `rows: number = 3`
  - `autoresize: boolean = false`
  - `maxLength?: number`
- Frame height is `auto` instead of the Field Size Scale height — size still controls padding/text.

### Size styling
```
frame base: same as TextField, but h-auto min-h-[calc(theme(spacing.9))]
frame size: sm='px-3 text-sm min-h-[theme(spacing.8)]' | md='px-4 text-sm min-h-[theme(spacing.9)]' | lg='px-6 text-base min-h-[theme(spacing.10)]'
textarea: 'flex-1 bg-transparent outline-none resize-none py-2 placeholder:text-muted-foreground'
```

### Autoresize
- Grows with content via `$effect` that adjusts `textarea.style.height`.
- Never shrinks below `rows * line-height`.
- `maxLength` enforces character cap via native attribute.

---

## 8.4 Checkbox

### Props
| Name | Type | Default |
|------|------|---------|
| `checked` | `boolean \| 'indeterminate'` (bindable) | `false` |
| `defaultChecked` | `boolean \| 'indeterminate'` | `false` |
| `label` | `string \| undefined` | — |
| `labelledBy` | `string \| undefined` | — |
| `description` | `string \| undefined` | — |
| `error` | `string \| undefined` | — |
| `disabled` | `boolean` | `false` |
| `required` | `boolean` | `false` |
| `name` | `string \| undefined` | — |
| `value` | `string` | `'on'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` (Control Size Scale) |
| `class` | `string \| undefined` | — |

### Snippets
- `default` (overrides `label`)
- `description`

### Events
- `onCheckedChange: (checked: boolean | 'indeterminate') => void`

### Accessibility
- Uses bits-ui `Checkbox.Root` + `Checkbox.Indicator`.
- `role="checkbox"`, `aria-checked` reflects state (`'mixed'` for indeterminate).
- `Space` toggles between unchecked ↔ checked; never cycles through indeterminate.
- Indeterminate state settable only via props.

### Styling
```
root base: 'salt-focus-ring peer shrink-0 rounded border border-input bg-background data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground'
root size: sm='h-3.5 w-3.5' | md='h-4 w-4' | lg='h-5 w-5'
indicator: 'flex items-center justify-center text-current'
label: 'text-sm font-medium text-foreground peer-data-[disabled]:opacity-50'
```

### Forbidden
- Do not render a native `<input type="checkbox">` — use bits-ui `Checkbox.Root`.

---

## 8.5 Switch

### Props
| Name | Type | Default |
|------|------|---------|
| `checked` | `boolean` (bindable) | `false` |
| `defaultChecked` | `boolean` | `false` |
| `disabled` | `boolean` | `false` |
| `required` | `boolean` | `false` |
| `name` | `string \| undefined` | — |
| `value` | `string` | `'on'` |
| `label` | `string` | **required** |
| `description` | `string \| undefined` | — |
| `error` | `string \| undefined` | — |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` (Control Size Scale) |
| `class` | `string \| undefined` | — |

### Events
- `onCheckedChange: (checked: boolean) => void`

### Accessibility
- Uses bits-ui `Switch.Root` + `Switch.Thumb`.
- `role="switch"`, `aria-checked`.
- `Space` / `Enter` toggle.

### Styling
```
root base: 'salt-focus-ring inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors motion-reduce:transition-none data-[state=checked]:bg-primary data-[state=unchecked]:bg-input'
root size: sm='h-4 w-7' | md='h-5 w-9' | lg='h-6 w-11'
thumb base: 'pointer-events-none block rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none data-[state=unchecked]:translate-x-0'
thumb size: sm='h-3 w-3 data-[state=checked]:translate-x-3' | md='h-4 w-4 data-[state=checked]:translate-x-4' | lg='h-5 w-5 data-[state=checked]:translate-x-5'
```

---

## 8.6 Dialog

### Parts
- `Dialog.svelte` (Root)
- `DialogTrigger.svelte`
- `DialogContent.svelte`
- `DialogHeader.svelte`
- `DialogTitle.svelte`
- `DialogDescription.svelte`
- `DialogFooter.svelte`
- `DialogClose.svelte`

### Root Props
| Name | Type | Default |
|------|------|---------|
| `open` | `boolean` (bindable) | `false` |
| `defaultOpen` | `boolean` | `false` |
| `portal` | `HTMLElement \| string \| false` | `"body"` |
| `class` | `string \| undefined` | — |

### Content Props
| Name | Type | Default |
|------|------|---------|
| `size` | `'sm' \| 'md' \| 'lg' \| 'xl' \| 'full'` | `'md'` (Dialog Size Scale) |
| `class` | `string \| undefined` | — |

### Events (Root)
- `onOpenChange: (open: boolean) => void`

### Accessibility
- Focus trap inside `DialogContent`.
- Focus restored to trigger on close.
- `role="dialog"`, `aria-modal="true"`.
- `DialogTitle` required — wired via `aria-labelledby`.
- `DialogDescription` optional — wired via `aria-describedby`.

### Styling
```
overlay: 'fixed inset-0 z-dialog bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none'
content base: 'fixed left-1/2 top-1/2 z-dialog grid -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-dialog'
content size: see §4.4 Dialog Size Scale
header: 'flex flex-col gap-1.5'
title: 'text-lg font-semibold text-foreground'
description: 'text-sm text-muted-foreground'
footer: 'flex justify-end gap-2'
close: styled as ghost Button, size='icon'
```

### Forbidden
- Do not implement a custom portal — use `Dialog.Portal` from bits-ui.
- Do not render `DialogContent` outside a `Dialog` root.

---

## 8.7 Popover

### Parts
- `Popover.svelte` (Root)
- `PopoverTrigger.svelte`
- `PopoverContent.svelte`

### Props (Root)
| Name | Type | Default |
|------|------|---------|
| `open` | `boolean` (bindable) | `false` |
| `defaultOpen` | `boolean` | `false` |
| `portal` | `HTMLElement \| string \| false` | `"body"` |
| `trapFocus` | `boolean` | `false` |
| `class` | `string \| undefined` | — |

### Props (Content)
| Name | Type | Default |
|------|------|---------|
| `side` | `'top' \| 'right' \| 'bottom' \| 'left'` | `'bottom'` |
| `align` | `'start' \| 'center' \| 'end'` | `'center'` |
| `sideOffset` | `number` | `4` |
| `class` | `string \| undefined` | — |

### Events (Root)
- `onOpenChange: (open: boolean) => void`

### Styling
```
content: 'z-popover w-72 rounded-md border bg-popover text-popover-foreground p-4 shadow-popover data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none'
```

---

## 8.8 Tooltip

### Parts
- `TooltipProvider.svelte`
- `Tooltip.svelte` (Root)
- `TooltipTrigger.svelte`
- `TooltipContent.svelte`

### Props (Root)
| Name | Type | Default |
|------|------|---------|
| `open` | `boolean` (bindable) | — |
| `defaultOpen` | `boolean` | `false` |
| `delayDuration` | `number` | `700` |
| `disableHoverableContent` | `boolean` | `false` |

### Props (Content)
| Name | Type | Default |
|------|------|---------|
| `side` | `'top' \| 'right' \| 'bottom' \| 'left'` | `'top'` |
| `sideOffset` | `number` | `4` |
| `class` | `string \| undefined` | — |

### Behavior
- Never takes focus.
- Open on hover + keyboard focus of the trigger.
- Close on `Escape`, pointer leave, or blur.

### Styling
```
content: 'z-tooltip rounded-md bg-foreground text-background px-2 py-1 text-xs shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out motion-reduce:animate-none'
```

### Forbidden
- Do not make tooltip content interactive.
- Do not use tooltip for critical information (it's not reliably discoverable on touch).

---

## 8.9 Card

### Parts
- `Card.svelte`
- `CardHeader.svelte`
- `CardTitle.svelte`
- `CardDescription.svelte`
- `CardContent.svelte`
- `CardFooter.svelte`

### Props (all parts)
| Name | Type | Default |
|------|------|---------|
| `class` | `string \| undefined` | — |

### Styling
```
card: 'rounded-lg border bg-card text-card-foreground shadow-sm'
header: 'flex flex-col gap-1.5 p-6'
title: 'text-lg font-semibold leading-none tracking-tight'
description: 'text-sm text-muted-foreground'
content: 'p-6 pt-0'
footer: 'flex items-center p-6 pt-0'
```

Pure styled `<div>`s — no state, no headless layer.

---

## 8.10 Heading

### Props
| Name | Type | Default |
|------|------|---------|
| `level` | `1 \| 2 \| 3 \| 4 \| 5 \| 6` | `2` |
| `class` | `string \| undefined` | — |

Renders `<h{level}>`. Snippet: `default` (children).

### Styling
```
base: 'font-semibold tracking-tight text-foreground'
level: 1='text-4xl' | 2='text-3xl' | 3='text-2xl' | 4='text-xl' | 5='text-lg' | 6='text-base'
```

---

## 8.11 Text

### Props
| Name | Type | Default |
|------|------|---------|
| `as` | `'p' \| 'span' \| 'div'` | `'p'` |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` (Text Size Scale) |
| `muted` | `boolean` | `false` |
| `class` | `string \| undefined` | — |

### Styling
```
base: 'leading-normal'
size: see §4.4 Text Size Scale
muted: true='text-muted-foreground' | false='text-foreground'
```

Note: `as` is constrained to a union — **not** an arbitrary string — to keep the component statically analyzable.

---

## 8.12 Icon

### Props
| Name | Type | Default |
|------|------|---------|
| `name` | `keyof typeof import('lucide-svelte')` | — (required) |
| `size` | `number` | `16` |
| `ariaLabel` | `string \| undefined` | — |
| `class` | `string \| undefined` | — |

### Accessibility
- Without `ariaLabel`: `aria-hidden="true"` (decorative).
- With `ariaLabel`: `role="img"` + `aria-label={ariaLabel}`.

### Styling
```
base: 'shrink-0'
```
SVG `width` / `height` attributes set to `size`; `class` can override via `w-*`/`h-*`.

---

## 8.13 Layout Primitives — Stack / Inline / Grid / Divider

### Stack
| Prop | Type | Default |
|------|------|---------|
| `gap` | `'0' \| '1' \| '2' \| '3' \| '4' \| '6' \| '8'` | `'4'` |
| `align` | `'start' \| 'center' \| 'end' \| 'stretch'` | `'stretch'` |
| `justify` | `'start' \| 'center' \| 'end' \| 'between'` | `'start'` |
| `class` | `string \| undefined` | — |

Renders `<div class="flex flex-col gap-{gap} items-{align} justify-{justify}">`. `gap` values map to Tailwind's spacing scale.

### Inline
Same props as Stack. Renders `<div class="flex flex-row ...">`.

### Grid
| Prop | Type | Default |
|------|------|---------|
| `cols` | `1 \| 2 \| 3 \| 4 \| 6 \| 12` | `2` |
| `gap` | (same as Stack) | `'4'` |
| `class` | `string \| undefined` | — |

Renders `<div class="grid grid-cols-{cols} gap-{gap}">`.

### Divider
| Prop | Type | Default |
|------|------|---------|
| `orientation` | `'horizontal' \| 'vertical'` | `'horizontal'` |
| `class` | `string \| undefined` | — |

Renders a `<div role="separator">`. Styling:
```
horizontal: 'h-px w-full bg-border'
vertical:   'w-px h-full bg-border'
```

---

## 8.14 Spinner

### Props
| Name | Type | Default |
|------|------|---------|
| `size` | `number` | `16` |
| `ariaLabel` | `string` | `'Loading'` |
| `class` | `string \| undefined` | — |

### Accessibility
- `role="status"`, `aria-label={ariaLabel}`.
- SVG itself `aria-hidden="true"`.

### Styling
Inline SVG with `animate-spin motion-reduce:animate-none`. Stroke uses `currentColor`.

---

## 8.15 Progress

### Props
| Name | Type | Default |
|------|------|---------|
| `value` | `number \| undefined` (bindable) | `undefined` |
| `defaultValue` | `number \| undefined` | `undefined` |
| `max` | `number` | `100` |
| `announce` | `'polite' \| 'off'` | `'polite'` |
| `ariaLabel` | `string \| undefined` | — |
| `class` | `string \| undefined` | — |

### Behavior
- `value === undefined` → **indeterminate** mode: indicator animates; `aria-valuenow` omitted.
- `value` is a finite number → **determinate** mode: indicator width = `(value / max) * 100%`.
- `value < 0` or `value > max` → clamp to range.

### Accessibility
- Uses bits-ui `Progress.Root` + `Progress.Indicator`.
- `role="progressbar"`.
- `aria-valuemin="0"`, `aria-valuemax={max}`, `aria-valuenow={value}` (determinate only).
- `aria-label={ariaLabel}` or `aria-labelledby` required if not visually labeled.
- `aria-live={announce}` when announce is `'polite'`.

### Styling
```
root: 'relative h-2 w-full overflow-hidden rounded-full bg-muted'
indicator determinate: 'h-full bg-primary transition-transform motion-reduce:transition-none'
indicator indeterminate: 'h-full w-1/3 bg-primary animate-[salt-progress-indeterminate_1s_ease_infinite] motion-reduce:animate-none'
```

Numeric transform (allowed by §2.3): determinate indicator uses `style="transform: translateX(-{100 - percent}%)"`.

### Forbidden
- Do not fire `onValueChange` — Progress value is driven by the consumer, not the primitive.

---

# 9. Changelog

| Date | Version | Summary |
|------|---------|---------|
| 2026-04-22 | v0.2.3 | §1.2 tightened to truly leaf (external-only) to match root CLAUDE.md and eslint.config.js. Removed `@salt/shared-types` from allowed imports list. |
| 2026-04-22 | v0.2.2 | Locked four implementation decisions: Svelte pin `^5.55.0` (§1.1), Icon surface `keyof typeof import('lucide-svelte')` (§1.1 + §8.12 unchanged), `tailwindcss-animate` registered by preset (§1.1 + §3.3), `useId` kept as module-scope counter explicitly **not SSR-safe** (§2.6). No breaking change to generated code. |
| 2026-04-21 | v0.2.1 | Finished Progress spec. Centralized headless layer under `src/headless/`. Added §1.4 event naming rule, §1.5 spec versioning, §3.5 helper signatures, §3.6 canonical Button example + controlled/uncontrolled + snippet patterns, §3.7 bits-ui mapping table, §3.8 provenance header convention, §4.4 shared size scale, §4.5 dark-mode contract, §6.2 test template. Added CVA class matrices to all primitives. Added per-primitive "Forbidden" lists. |
| earlier | v0.2 | Initial draft. |
