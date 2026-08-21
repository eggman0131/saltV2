// spec: ui-spec-v09.md §8.25 v0.9
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';

export type CollapsibleSectionProps = {
  /** Header label. Upper-cased by the style, not by the caller. */
  title: string;
  /** Open state. Required and never defaulted — the page owns it (§8.25.4). */
  expanded: boolean;
  /** Called on header activation. The section never flips itself. */
  onToggle: () => void;
  /**
   * Rendered as `(N)` only while collapsed. Omit for a section that carries its
   * count in the title instead.
   */
  collapsedCount?: number | undefined;
  /** Trailing header content — a control acting on the whole section. */
  action?: Snippet;
  /**
   * `data-testid` for the header button. `...rest` lands on the `<section>`, but
   * the thing a test clicks is one level in (§8.25.5).
   */
  triggerTestId?: string | undefined;
  /** The body. Not rendered at all while collapsed (§8.25.3). */
  children?: Snippet;
  class?: string;
} & Omit<HTMLAttributes<HTMLElement>, 'class' | 'title'>;
