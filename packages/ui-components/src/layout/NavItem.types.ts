export interface NavItem {
  id: string;
  label: string;
  // lucide-svelte ships Svelte 4-style class components (extends SvelteComponentTyped)
  // which are not assignable to the Svelte 5 Component<> type under strict mode.
  // `any` is intentional here — type safety on icon props is not worth the workaround.
  // biome-ignore lint/suspicious/noExplicitAny: intentional for icon compatibility
  icon: any;
  href: string;
  badge?: number;
}
