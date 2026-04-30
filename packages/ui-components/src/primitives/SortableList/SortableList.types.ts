import type { Snippet } from 'svelte';

export type SortableListProps<T> = {
  items: T[];
  getId: (item: T) => string;
  onReorder: (orderedIds: string[]) => void;
  row: Snippet<[T]>;
  class?: string;
};
