import type { Snippet } from 'svelte';

export interface TopBarProps {
  title?: string;
  actions?: Snippet | undefined;
  class?: string;
}
