// spec: SPEC.md §9.1 v0.2.3
import type { Snippet } from 'svelte';

export type ListPageProps = {
  title: string;
  description?: string;
  toolbar?: Snippet;
  actions?: Snippet;
  isLoading?: boolean;
  isError?: boolean;
  isEmpty?: boolean;
  loading?: Snippet;
  error?: Snippet;
  empty?: Snippet;
  children?: Snippet;
  class?: string;
};
