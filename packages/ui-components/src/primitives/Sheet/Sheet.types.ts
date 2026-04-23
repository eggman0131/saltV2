// spec: SPEC.md §5 v0.3
import type { Snippet } from 'svelte';

export type SheetSide = 'left' | 'right' | 'top' | 'bottom';

export type SheetProps = {
  open?: boolean;
  defaultOpen?: boolean;
  side?: SheetSide;
  portal?: HTMLElement | string | false;
  class?: string;
  children?: Snippet;
  onOpenChange?: (open: boolean) => void;
};

export type SheetContentProps = {
  class?: string;
  children?: Snippet;
};

export type SheetPartProps = {
  class?: string;
  children?: Snippet;
};
