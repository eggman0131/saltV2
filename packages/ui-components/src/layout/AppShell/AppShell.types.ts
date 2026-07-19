import type { Snippet } from 'svelte';
import type { NavItem } from '../NavItem.types';

export interface AppShellProps {
  navItems: NavItem[];
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
