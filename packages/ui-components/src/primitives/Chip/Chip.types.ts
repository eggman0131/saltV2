// spec: ui-spec-v09.md §8.23, §8.24 v0.9.2
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';

/**
 * The attribute passthrough shared by all four variants: `onclick`,
 * `data-testid`, `data-*`, `title`, `id`, `aria-*`.
 *
 * `HTMLAttributes<HTMLElement>`, NOT `HTMLButtonAttributes` as v0.9 had it —
 * two of the four variants render a `<span>` (§8.23.8), and a passthrough that
 * advertised `disabled`, `type` or `form` would be offering a page attributes
 * the element it lands on cannot honour. Nothing is lost: `disabled` was the
 * only button-only attribute v0.9 §8.23.3 named, §8.23.7 has always said a chip
 * has no disabled treatment, and no call site passed one.
 *
 * One base for every member also keeps the union small enough to survive
 * `Meta<typeof Chip>` in Storybook — a union of `HTMLButtonAttributes` and
 * `HTMLAttributes<HTMLSpanElement>` is "too complex to represent" there.
 */
type ChipAttributes = Omit<HTMLAttributes<HTMLElement>, 'class'>;

/**
 * The two pressable chips: `filter` (the toggle) and `expander` (the dashed
 * "+N more" / "Show less"). Both render `<button type="button">`, and
 * `onclick`, `data-testid` and the rest ride `...rest` onto it (§8.23.3).
 */
export type ChipToggleProps = {
  variant?: 'filter' | 'expander';
  /**
   * The toggle state, rendered as `aria-pressed`. Ignored by `expander`, which
   * is an action rather than a state (§8.23.6).
   */
  pressed?: boolean;
  /** Not available here: only `fact` carries an icon (§8.23.7). */
  icon?: never;
  /** The chip's label, and its accessible name. Text only. */
  children?: Snippet;
  class?: string;
} & ChipAttributes;

/**
 * `fact` — a measured attribute of the thing being read: "Serves 4",
 * "Prep 40 min". Tinted ground, optional leading icon, renders a `<span>`
 * (§8.23.8).
 */
export type ChipFactProps = {
  variant: 'fact';
  /** Not available here: nothing static has a pressed state (§8.23.6). */
  pressed?: never;
  /** A leading glyph. Sized by the style, not the caller (§8.23.8). */
  icon?: Snippet;
  children?: Snippet;
  class?: string;
} & Omit<ChipAttributes, 'onclick'> & { onclick?: never };

/**
 * `tag` — a word someone attached to the thing, not measured from it. Quiet
 * outline, no icon, renders a `<span>` (§8.23.8).
 */
export type ChipTagProps = {
  variant: 'tag';
  pressed?: never;
  /** Not available here: an icon beside an arbitrary word would be a guess. */
  icon?: never;
  children?: Snippet;
  class?: string;
} & Omit<ChipAttributes, 'onclick'> & { onclick?: never };

/**
 * A discriminated union on `variant`, so a `fact` chip cannot be handed
 * `pressed`, a `tag` cannot be handed an `icon`, and neither can be handed an
 * `onclick`.
 *
 * Every member declares every Salt-owned prop — the disallowed ones as
 * `never` — which is what keeps the union destructurable inside `Chip.svelte`
 * (`$props()` must be annotated with the exported type, or the constraint would
 * never reach a call site). Safe here because no consumer picks `variant`
 * dynamically; all five call sites pass a literal.
 */
export type ChipProps = ChipToggleProps | ChipFactProps | ChipTagProps;

export type ChipGroupProps = {
  /**
   * Names the set. Given, the row becomes a `role="group"`; omitted, it stays a
   * plain `<div>` rather than an unnamed group (§8.24.4).
   *
   * Explicitly `| undefined` under `exactOptionalPropertyTypes`, so a consumer
   * whose name is conditional can pass it straight through instead of branching
   * on the whole element. An explicit `undefined` means the same as omitting it.
   */
  ariaLabel?: string | undefined;
  children?: Snippet;
  class?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, 'class'>;
