// spec: ui-spec-v04.md §7 v0.4
import type { Snippet } from 'svelte';

export type EditableRowProps = {
  selected?: boolean;
  shaded?: boolean;
  onToggleSelect?: () => void;
  narrow?: Snippet;
  wide?: Snippet;
};
