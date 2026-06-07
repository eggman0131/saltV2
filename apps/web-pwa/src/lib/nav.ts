import { BookOpen, Home, Settings, Shield, ShoppingCart, Utensils } from 'lucide-svelte';
import type { NavItem } from '@salt/ui-components';

export const navItems: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home, href: '#/' },
  { id: 'shopping', label: 'Shop', icon: ShoppingCart, href: '#/shopping' },
  { id: 'canon', label: 'Items', icon: BookOpen, href: '#/canon' },
  { id: 'equipment', label: 'Kitchen', icon: Utensils, href: '#/equipment' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '#/settings' },
];

// Operator-area entry (issue #155). Appended to the nav only for admins —
// see App.svelte. Cosmetic gating only; the real boundary is server-side.
export const adminNavItem: NavItem = {
  id: 'admin',
  label: 'Admin',
  icon: Shield,
  href: '#/admin',
};
