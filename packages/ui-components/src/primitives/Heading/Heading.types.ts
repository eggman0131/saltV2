// spec: SPEC.md §8.10 v0.2.3
import type { Snippet } from 'svelte';

export type HeadingProps = {
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  class?: string;
  children?: Snippet;
};
