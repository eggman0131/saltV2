// spec: ui-spec-v04.md §13 v0.4
import type { Snippet } from 'svelte';
import type { NavItem } from '../NavItem.types';

export interface SideNavProps {
  items: NavItem[];
  currentPath: string;
  footer?: Snippet | undefined;
  class?: string;
}
