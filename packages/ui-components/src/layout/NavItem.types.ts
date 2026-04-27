import type { Component } from 'svelte';

export interface NavItem {
  id: string;
  label: string;
  icon: Component<{ size?: number | string; class?: string; 'aria-hidden'?: string | boolean }>;
  href: string;
  badge?: number;
}
