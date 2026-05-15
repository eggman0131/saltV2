import { BookOpen, Home, Settings, ShoppingCart, Utensils } from 'lucide-svelte';
import type { NavItem } from '@salt/ui-components';

export const navItems: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home, href: '#/' },
  { id: 'shopping', label: 'Shop', icon: ShoppingCart, href: '#/shopping' },
  { id: 'canon', label: 'Items', icon: BookOpen, href: '#/canon' },
  { id: 'equipment', label: 'Kitchen', icon: Utensils, href: '#/equipment' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '#/settings' },
];
