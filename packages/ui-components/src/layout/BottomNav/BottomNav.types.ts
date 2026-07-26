import type { NavItem } from '../NavItem.types';

export interface BottomNavProps {
  items: NavItem[];
  /**
   * Secondary destinations folded behind a trailing "More" tab, which opens them
   * in a bottom sheet. Keeping `items` to four leaves each tab wide enough for the
   * active-indicator pill. Omit (or pass empty) and no More tab is rendered.
   */
  overflowItems?: NavItem[];
  /** Label for the overflow tab, and the heading of the sheet it opens. */
  overflowLabel?: string;
  currentPath: string;
  class?: string;
}
