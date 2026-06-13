import {
  Blender,
  BookOpen,
  CalendarDays,
  ChefHat,
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
  { id: 'equipment', label: 'Kitchen', icon: Blender, href: '#/equipment' },
  // AI Kitchen Assistant (issue #206) — available to all members.
  { id: 'chat', label: 'Chef', icon: ChefHat, href: '#/chat' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '#/settings' },
];

// The recipe module is still incomplete (issue #179). Until it's ready for
// everyone, keep it out of the default nav and surface it only to admins — the
// same cosmetic gating used for the operator area. Route-level AdminGuard on the
// recipe pages is the matching server-agnostic backstop against direct URLs.
export const recipesNavItem: NavItem = {
  id: 'recipes',
  label: 'Recipes',
  icon: BookOpen,
  href: '#/recipes',
};

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
