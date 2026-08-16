// spec: SPEC.md §8.22 v0.8
import type { Snippet } from 'svelte';
import type { DialVariants } from './Dial.variants';

export type DialProps = {
  /** How much of the ring is drawn, 0..1. Values outside the range are clamped. */
  value?: number;
  /** Ring diameter. `sm` (34px) is the badge size, `md` (44), `lg` (60). */
  size?: DialVariants['size'];
  /**
   * Sweep colour. `heat` inherits `--salt-dial-heat` from the nearest ancestor
   * that sets it, so a card can colour its own dial without this primitive
   * knowing anything about timers.
   */
  tone?: DialVariants['tone'];
  /** Rendered in the middle of the ring — a clock, a count, nothing. */
  children?: Snippet;
  /**
   * Required unless the dial is decorative. A ring with no label is invisible to
   * a screen reader, so `null` is the explicit way to say "the text beside me
   * already says this" and get `aria-hidden` instead.
   */
  ariaLabel: string | null;
  class?: string;
};
