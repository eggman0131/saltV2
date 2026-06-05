// spec: ui-spec-v04.md §10 v0.4
import type { Snippet } from 'svelte';

export type SelectableListItem = { id: string };

export type SelectableListProps<T extends SelectableListItem = SelectableListItem> = {
  items: T[];
  selected?: Set<string>;
  selectionMode?: boolean;
  row: Snippet<[T, { selected: boolean; toggle: () => void }]>;
  class?: string;
};
