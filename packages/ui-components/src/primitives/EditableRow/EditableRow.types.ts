import type { Snippet } from 'svelte';

export type EditableRowProps = {
  selected?: boolean;
  shaded?: boolean;
  onToggleSelect?: () => void;
  narrow?: Snippet;
  wide?: Snippet;
};
