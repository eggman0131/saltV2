// spec: ui-spec-v14.md §8.33 v0.14
import type { Snippet } from 'svelte';
import type { HTMLButtonAttributes } from 'svelte/elements';
import type { IconName } from '../Icon/iconRegistry';

/**
 * One row of a popover menu (§8.33).
 *
 * `HTMLButtonAttributes`, not `HTMLAttributes<HTMLElement>` as `Chip` uses: a
 * menu row is always a `<button type="button">` (§8.33.1), so `disabled` is a
 * real attribute here rather than one the element could not honour. `onclick`,
 * `data-testid` and `data-*` ride `...rest` onto it.
 */
export type PopoverMenuItemProps = {
  /**
   * Which hover ground, and whether the label is destructive-coloured.
   * `destructive` REPLACES the neutral hover rather than adding to it — a
   * destructive row reads destructive at rest.
   */
  variant?: 'default' | 'destructive';
  /**
   * A leading glyph, **named** rather than drawn: the component renders
   * `<Icon name={icon} size={14} />` itself (§8.33.7).
   *
   * A `Snippet` here would let a caller pass a pictogram or a wrongly-sized
   * glyph, and TypeScript cannot see inside one — the same failure v0.9 §8.23.8
   * was amended for after #1051. A name from the closed registry makes the
   * wrong thing unrepresentable instead of merely discouraged.
   *
   * Explicitly `| undefined` under `exactOptionalPropertyTypes`, so a caller
   * whose glyph is conditional can pass it straight through.
   */
  icon?: IconName | undefined;
  /**
   * When `false`, the glyph is rendered but not painted, keeping its column
   * (§8.33.8). This is how a menu of mutually exclusive options marks the chosen
   * one with a tick while the other rows' labels stay aligned — a conditional
   * `{#if}` would collapse the column and shuffle every other label left.
   *
   * Meaningless without `icon`, and ignored when there is none.
   */
  iconVisible?: boolean;
  /**
   * Marks this row as the chosen one, by weight alone.
   *
   * Presentational, not semantic: it sets no `aria-checked` and no
   * `aria-current`. §8.33.6 states why, and that a menu which genuinely is a
   * radio group needs the spec amended before it is built on this.
   */
  selected?: boolean;
  /** The row's label. Text. */
  children?: Snippet;
  class?: string;
} & Omit<HTMLButtonAttributes, 'class' | 'type' | 'children'>;
