import {
  Blender,
  BookOpen,
  CalendarDays,
  Home,
  Settings,
  Shield,
  ShoppingCart,
} from '@lucide/svelte';
import type { NavItem } from '@salt/ui-components';

export const navItems: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home, href: '#/' },
  { id: 'shopping', label: 'Shop', icon: ShoppingCart, href: '#/shopping' },
  { id: 'mealplan', label: 'Meals', icon: CalendarDays, href: '#/mealplan' },
  { id: 'recipes', label: 'Recipes', icon: BookOpen, href: '#/recipes' },
  { id: 'equipment', label: 'Kitchen', icon: Blender, href: '#/equipment' },
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
