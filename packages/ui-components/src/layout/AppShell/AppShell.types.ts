import type { Snippet } from 'svelte';
import type { NavItem } from '../NavItem.types';

export interface AppShellProps {
  navItems: NavItem[];
  /**
   * Secondary destinations. The desktop SideNav has room, so it lists them inline
   * after `navItems`; the mobile BottomNav folds them behind its "More" tab.
   */
  overflowNavItems?: NavItem[];
  currentPath: string;
  title?: string;
  actions?: Snippet;
  /** Centred non-prod environment label for the TopBar; omit in production. */
  envLabel?: string | undefined;
  /** Tailwind classes overriding the TopBar surface for a non-prod environment. */
  envClass?: string | undefined;
  sideNavFooter?: Snippet;
  /**
   * Whether to render the shell's navigation chrome (`TopBar`, `SideNav`,
   * `BottomNav`). Defaults to `true`.
   *
   * Set `false` for a FULL-VIEWPORT route — a genuinely modal, single-task mode
   * that owns the whole screen (see ui-spec-v05 §3). The chrome is not rendered
   * at all rather than merely covered: a page painting over it leaves `TopBar`
   * and `BottomNav` in the DOM, in the tab order, and in the accessibility tree,
   * so keyboard focus lands on invisible navigation behind the overlay and
   * activating it navigates away mid-task (issue #641). `<main>` also drops its
   * BottomNav height reservation, since there is no BottomNav to clear.
   */
  chrome?: boolean;
  class?: string;
  children?: Snippet;
}
