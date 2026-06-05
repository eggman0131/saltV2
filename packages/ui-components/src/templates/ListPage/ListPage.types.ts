// spec: ui-spec-v04.md §9 v0.4
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';

export type ListPageProps = {
  title: string;
  titleSlot?: Snippet;
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
  /**
   * Header action buttons, rendered to the right of the built-in Select/Done toggle.
   * Convention: use size="sm" on every button here so they line up with the Select
   * toggle (which is sm); mixing in the default md size leaves the row uneven.
   */
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
