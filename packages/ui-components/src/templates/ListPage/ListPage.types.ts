// spec: SPEC.md §9.1 v0.2.3
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';

export type ListPageProps = {
  title: string;
  description?: string;
  toolbar?: Snippet;
  /**
   * Rendered inside a grey bar between the header and content when items are selected.
   * Convention: show selection count on the Checkbox label ("3 selected"), use
   * variant="destructive" for delete actions, variant="outline" for non-destructive
   * bulk actions (e.g. merge), variant="ghost" for Clear.
   */
  selectionBar?: Snippet;
  selectionMode?: boolean;
  actions?: Snippet;
  isLoading?: boolean;
  isError?: boolean;
  isEmpty?: boolean;
  loading?: Snippet;
  error?: Snippet;
  empty?: Snippet;
  children?: Snippet;
  class?: string;
} & Omit<HTMLAttributes<HTMLElement>, 'class'>;
