// spec: SPEC.md §9.4 v0.2.3
import type { Snippet } from 'svelte';

export type SelectableListItem = { id: string };

export type SelectableListProps<T extends SelectableListItem = SelectableListItem> = {
  items: T[];
  selected?: Set<string>;
  row: Snippet<[T, { selected: boolean; toggle: () => void }]>;
  class?: string;
};
