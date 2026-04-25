// spec: SPEC.md §8.26 v0.2.3
import type { Snippet } from 'svelte';

export type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  actions?: Snippet;
  class?: string;
};
