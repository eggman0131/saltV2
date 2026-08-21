// spec: ui-spec-v09.md §8.26 v0.9
import type { Snippet } from 'svelte';
import type { HTMLButtonAttributes } from 'svelte/elements';

export type DisclosureTriggerProps = {
  /** Rendered as `aria-expanded`. The trigger never flips it itself. */
  expanded: boolean;
  /** The trigger's content — including wherever the chevron belongs. */
  children?: Snippet;
  /** The caller's layout. The trigger ships none of its own (§8.26.3). */
  class?: string;
} & Omit<HTMLButtonAttributes, 'class'>;

export type DisclosureChevronProps = {
  expanded: boolean;
  /** 14 for a section header, 12 inside a row's sub-label. */
  size?: number;
};
