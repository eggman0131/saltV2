// spec: SPEC.md §8.8 v0.2.3
import type { Snippet } from 'svelte';

export type TooltipProviderProps = {
  children?: Snippet;
};

export type TooltipProps = {
  open?: boolean;
  defaultOpen?: boolean;
  delayDuration?: number;
  disableHoverableContent?: boolean;
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
