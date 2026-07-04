<!-- Composition wrapper for BottomNav.stories.ts. BottomNav needs a NavItem[] and
     renders `badge` counts — a single `component` + `args` cannot supply the items.
     BottomNav is `fixed ... bottom-0 lg:hidden` (mobile-only, pinned to the viewport
     bottom); we pass class="relative lg:block" (cn-merged so both win) to un-pin it
     and keep it visible at any canvas width for a self-contained snapshot. A
     `withBadge` boolean adds a badge to one item. Rule 7: only @salt/ui-components
     (icons come via the shared navItems). -->
<script lang="ts">
  import { BottomNav } from '@salt/ui-components';
  import type { NavItem } from '@salt/ui-components';
  import { demoNavItems } from './navItems';

  let {
    currentPath = '/',
    withBadge = false,
  }: {
    currentPath?: string;
    withBadge?: boolean;
  } = $props();

  // Trim to four items (a realistic mobile bottom bar) and optionally badge one.
  const items = $derived<NavItem[]>(
    demoNavItems
      .slice(0, 4)
      .map((item) => (withBadge && item.id === 'shopping' ? { ...item, badge: 3 } : item)),
  );
</script>

<div class="w-full max-w-lg overflow-hidden rounded-lg border border-border">
  <BottomNav {items} {currentPath} class="relative lg:block" />
</div>
