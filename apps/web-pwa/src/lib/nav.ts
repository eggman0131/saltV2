import { BookOpen, Home, Settings } from 'lucide-svelte';
import type { NavItem } from '@salt/ui-components';

export const navItems: NavItem[] = [
  { id: 'home', label: 'Home', icon: Home, href: '#/' },
  { id: 'canon', label: 'Ingredients', icon: BookOpen, href: '#/canon' },
  { id: 'settings', label: 'Settings', icon: Settings, href: '#/settings' },
];
