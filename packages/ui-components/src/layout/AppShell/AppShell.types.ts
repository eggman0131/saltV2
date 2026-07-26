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
  class?: string;
  children?: Snippet;
}
