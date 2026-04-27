import type { Snippet } from 'svelte';
import type { NavItem } from '../NavItem.types';

export interface SideNavProps {
  items: NavItem[];
  currentPath: string;
  footer?: Snippet | undefined;
  class?: string;
}
