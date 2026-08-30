<script lang="ts">
  import PopoverMenuItem from '../../src/primitives/Popover/PopoverMenuItem.svelte';
  import type { PopoverMenuItemProps } from '../../src/primitives/Popover/PopoverMenuItem.types';

  // A row's label is a snippet, and `render()` cannot hand a component one — so
  // the label rides in as a plain string and this fixture renders it. Every real
  // call site has a label; a row without one has no accessible name, which is
  // what the axe assertion here would otherwise be measuring.
  let { label = 'Edit', ...item }: { label?: string } & PopoverMenuItemProps = $props();
</script>

<PopoverMenuItem {...item} data-testid="menu-item">{label}</PopoverMenuItem>
