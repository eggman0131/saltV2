// spec: SPEC.md §8.13 v0.2.3
import type { Snippet } from 'svelte';

export type GridProps = {
  cols?: 1 | 2 | 3 | 4 | 6 | 12;
  gap?: '0' | '1' | '2' | '3' | '4' | '6' | '8';
  class?: string;
  children?: Snippet;
};
