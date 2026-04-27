import type { Snippet } from 'svelte';
import type { NavItem } from '../NavItem.types';

export interface AppShellProps {
  navItems: NavItem[];
  currentPath: string;
  title?: string;
  actions?: Snippet;
  sideNavFooter?: Snippet;
  class?: string;
  children?: Snippet;
}
