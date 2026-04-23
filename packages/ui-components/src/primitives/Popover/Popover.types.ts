// spec: SPEC.md §8.7 v0.2.3
import type { Snippet } from 'svelte';

export type PopoverProps = {
  open?: boolean;
  defaultOpen?: boolean;
  portal?: HTMLElement | string | false;
  trapFocus?: boolean;
  class?: string;
  children?: Snippet;
  onOpenChange?: (open: boolean) => void;
};

export type PopoverContentProps = {
  side?: 'top' | 'right' | 'bottom' | 'left';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  class?: string;
  children?: Snippet;
};

export type PopoverPartProps = {
  class?: string;
  children?: Snippet;
};
