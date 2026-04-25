// spec: SPEC.md §8.25 v0.2.3
import type { Snippet } from 'svelte';

export type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: Snippet;
  actions?: Snippet;
  class?: string;
};
