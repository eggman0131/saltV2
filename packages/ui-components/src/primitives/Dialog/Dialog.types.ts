// spec: SPEC.md §8.6 v0.2.3
import type { Snippet } from 'svelte';

export type DialogProps = {
  open?: boolean;
  defaultOpen?: boolean;
  portal?: HTMLElement | string | false;
  class?: string;
  children?: Snippet;
  onOpenChange?: (open: boolean) => void;
};

export type DialogContentProps = {
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  class?: string;
  children?: Snippet;
};

export type DialogPartProps = {
  class?: string;
  children?: Snippet;
};
