// spec: ui-spec-v04.md §10 v0.4
import type { Snippet } from 'svelte';
import type { ListSelection } from './listSelection.svelte.js';

export type SelectableListItem = { id: string };

export type SelectableListProps<T extends SelectableListItem = SelectableListItem> = {
  items: T[];
  /** Shared selection controller (see `createListSelection`). */
  selection: ListSelection;
  row: Snippet<[T, { selected: boolean; toggle: () => void }]>;
  class?: string;
};
