// spec: SPEC.md §8.11 v0.2.3
import type { Snippet } from 'svelte';

export type TextProps = {
  as?: 'p' | 'span' | 'div';
  size?: 'sm' | 'md' | 'lg';
  muted?: boolean;
  class?: string;
  children?: Snippet;
};
