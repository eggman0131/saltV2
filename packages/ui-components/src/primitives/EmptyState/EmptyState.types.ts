// spec: ui-spec-v13.md §8.31 v0.13.1
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';

export type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: Snippet;
  actions?: Snippet;
  class?: string;
  /**
   * `role` is NOT passable. §8.31.2 makes the `status` / `alert` split the whole
   * reason `EmptyState` and `ErrorState` are two components rather than one with
   * a `tone`; a caller able to override it could collapse that distinction from
   * the outside. Everything else on the panel element — `data-testid`, `data-*`,
   * `id`, `aria-*` — rides `...rest`, which is what the four migrated sites in
   * #930 Phase 9 needed and could not have.
   */
} & Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'role'>;
