// spec: ui-spec-v13.md §8.31 v0.13
import type { Snippet } from 'svelte';

export type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: Snippet;
  actions?: Snippet;
  class?: string;
};
