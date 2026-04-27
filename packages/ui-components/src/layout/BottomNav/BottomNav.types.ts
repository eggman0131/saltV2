import type { NavItem } from '../NavItem.types';

export interface BottomNavProps {
  items: NavItem[];
  currentPath: string;
  class?: string;
}
