// spec: SPEC.md §9.4 v0.2.3
import type { Snippet } from 'svelte';

export type SelectableListItem = { id: string };

export type BulkAction = {
  id: string;
  label: string;
  variant?: 'solid' | 'outline' | 'ghost' | 'destructive';
  onAction: (ids: string[]) => void;
};

export type SelectableListProps<T extends SelectableListItem = SelectableListItem> = {
  items: T[];
  selected?: Set<string>;
  bulkActions?: BulkAction[];
  selectionLabel?: (count: number) => string;
  row: Snippet<[T, { selected: boolean; toggle: () => void }]>;
  class?: string;
};
