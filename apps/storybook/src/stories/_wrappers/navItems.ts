// Shared demo `NavItem[]` for the Layout/* stories (AppShell, SideNav, BottomNav).
// `NavItem.icon` is typed as a Lucide COMPONENT, so the icons are imported from
// @lucide/svelte — the one sanctioned non-@salt import in these stories (it is an
// icon library, not a Rule-7 UI primitive; web-pwa imports it directly). The `NavItem`
// type comes from @salt/ui-components. Note the v1 name change: Home → House.
import type { NavItem } from '@salt/ui-components';
import { House, Search, ShoppingCart, CalendarDays, Settings } from '@lucide/svelte';

export const demoNavItems: NavItem[] = [
  { id: 'home', label: 'Home', icon: House, href: '/' },
  { id: 'recipes', label: 'Recipes', icon: Search, href: '/recipes' },
  { id: 'shopping', label: 'Shopping', icon: ShoppingCart, href: '/shopping' },
  { id: 'planner', label: 'Planner', icon: CalendarDays, href: '/planner' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '/settings' },
];
