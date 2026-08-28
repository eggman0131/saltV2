// spec: ui-spec-v13.md §8.32 v0.13
import type { Snippet } from 'svelte';

export type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  actions?: Snippet;
  class?: string;
};
