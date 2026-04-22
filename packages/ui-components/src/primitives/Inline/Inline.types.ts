// spec: SPEC.md §8.13 v0.2.3
import type { Snippet } from 'svelte';

export type InlineProps = {
  gap?: '0' | '1' | '2' | '3' | '4' | '6' | '8';
  align?: 'start' | 'center' | 'end' | 'stretch';
  justify?: 'start' | 'center' | 'end' | 'between';
  class?: string;
  children?: Snippet;
};
