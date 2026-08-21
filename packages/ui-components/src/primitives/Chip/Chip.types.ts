// spec: ui-spec-v09.md §8.23, §8.24 v0.9
import type { Snippet } from 'svelte';
import type { HTMLAttributes, HTMLButtonAttributes } from 'svelte/elements';
import type { ChipVariants } from './Chip.variants';

export type ChipProps = {
  /** `filter` is the toggle; `expander` is the dashed "+N more" / "Show less". */
  variant?: ChipVariants['variant'];
  /**
   * The toggle state, rendered as `aria-pressed`. Ignored by `expander`, which
   * is an action rather than a state (§8.23.6).
   */
  pressed?: boolean;
  /** The chip's label, and its accessible name. Text only. */
  children?: Snippet;
  class?: string;
} & Omit<HTMLButtonAttributes, 'class'>;

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
