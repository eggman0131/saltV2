// spec: ui-spec-v04.md §7 v0.4
import type { Snippet } from 'svelte';

export type EditableRowProps = {
  selected?: boolean;
  shaded?: boolean;
  // `| undefined` so callers may pass a conditional handler
  // (`cond ? fn : undefined`) under exactOptionalPropertyTypes; the component
  // guards `{#if onToggleSelect !== undefined}`.
  onToggleSelect?: (() => void) | undefined;
  narrow?: Snippet;
  wide?: Snippet;
};
