import { BookOpen, Home, Settings, Utensils } from 'lucide-svelte';
import type { NavItem } from '@salt/ui-components';

export const navItems: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home, href: '#/' },
  { id: 'canon', label: 'Items', icon: BookOpen, href: '#/canon' },
  { id: 'equipment', label: 'Kitchen', icon: Utensils, href: '#/equipment' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '#/settings' },
];
