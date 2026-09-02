// spec: ui-spec-v04.md §13 v0.4; ui-spec-v15.md §1.3 v0.15 (id)
import type { Snippet } from 'svelte';
import type { NavItem } from '../NavItem.types';

/**
 * The `<nav>`'s id — part of `SideNav`'s contract rather than a styling hook.
 *
 * It exists for one reference: `TopBar`'s collapse control has to point
 * `aria-controls` at the element it controls (ui-spec-v15 §1.3). Both sides read
 * this one string, so the two cannot drift, and `AppShell.test.ts` asserts the
 * control's `aria-controls` resolves to the rendered nav. Nothing selects on it
 * for layout.
 */
export const SIDE_NAV_ID = 'salt-side-nav';

export interface SideNavProps {
  items: NavItem[];
  currentPath: string;
  footer?: Snippet | undefined;
  class?: string;
}
