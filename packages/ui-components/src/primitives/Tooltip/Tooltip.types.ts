// spec: SPEC.md §8.8 v0.2.6
import type { Snippet } from 'svelte';

export type TooltipProviderProps = {
  children?: Snippet;
};

export type TooltipProps = {
  open?: boolean;
  defaultOpen?: boolean;
  delayDuration?: number;
  disableHoverableContent?: boolean;
  /** When true, clicking/tapping the trigger does not close the tooltip — pair with
   *  a controlled `open` + a tap toggle to make the tooltip readable on touch. */
  disableCloseOnTriggerClick?: boolean;
  /** When true, focus only opens the tooltip for real keyboard focus (not the focus
   *  a tap/click incurs). Stops a tap's focus-open from racing a click toggle on
   *  touch; mouse hover and keyboard Tab still open it. */
  ignoreNonKeyboardFocus?: boolean;
  children?: Snippet;
  onOpenChange?: (open: boolean) => void;
};

export type TooltipContentProps = {
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  class?: string;
  children?: Snippet;
};

export type TooltipPartProps = {
  children?: Snippet;
};
