import {
  Blender,
  BookOpen,
  CalendarDays,
  ChefHat,
  Settings,
  Shield,
  ShoppingCart,
} from '@lucide/svelte';
import type { NavItem } from '@salt/ui-components';

// The four daily-driver destinations. Kept to four so the mobile BottomNav has room
// for its active-indicator pill; everything else goes in `overflowNavItems`. The
// desktop SideNav shows both lists inline (see AppShell).
export const navItems: NavItem[] = [
  { id: 'shopping', label: 'Shop', icon: ShoppingCart, href: '#/shopping' },
  { id: 'mealplan', label: 'Planner', icon: CalendarDays, href: '#/mealplan' },
  { id: 'recipes', label: 'Recipes', icon: BookOpen, href: '#/recipes' },
  // AI Kitchen Assistant (issue #206) — available to all members.
  { id: 'chat', label: 'Chef', icon: ChefHat, href: '#/chat' },
];

// Set-up-and-forget destinations: folded behind the BottomNav's "More" tab on
// mobile. `adminNavItem` is appended here (admins only) in App.svelte.
export const overflowNavItems: NavItem[] = [
  { id: 'equipment', label: 'Equipment', icon: Blender, href: '#/equipment' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '#/settings' },
];

// Operator-area entry (issues #155, #157). Appended to the nav only for admins —
// see App.svelte, which also hangs the canon needs-approval badge here now that
// canon management lives behind the operator area. Cosmetic gating only; the
// real boundary is server-side.
export const adminNavItem: NavItem = {
  id: 'admin',
  label: 'Admin',
  icon: Shield,
  href: '#/admin',
};
