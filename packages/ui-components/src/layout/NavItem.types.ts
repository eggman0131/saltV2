import type { LucideIcon } from '@lucide/svelte';

export interface NavItem {
  id: string;
  label: string;
  // @lucide/svelte ships Svelte 5-native components typed as Component<LucideProps>,
  // so the icon can be strongly typed (the old lucide-svelte Svelte 4 class-component
  // workaround that forced `any` is no longer needed).
  icon: LucideIcon;
  href: string;
  badge?: number;
}
