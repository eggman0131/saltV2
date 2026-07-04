<!-- Icon showcase wrapper for Icon.stories.ts. A single Icon `component` can't
     express the Gallery grid, so this wrapper drives both: `gallery=false`
     renders one Icon (name/size stay live controls); `gallery=true` renders a
     representative grid. Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { Icon } from '@salt/ui-components';
  import type { IconProps } from '@salt/ui-components';

  let {
    name = 'Star',
    size = 24,
    gallery = false,
  }: {
    name?: IconProps['name'];
    size?: number;
    gallery?: boolean;
  } = $props();

  // Typed against Icon's real `name` union so a bad Lucide name fails
  // `pnpm check`. NB: Lucide renamed Home → House, so House is used here.
  const galleryNames: IconProps['name'][] = [
    'Bell',
    'Check',
    'ChevronDown',
    'CircleAlert',
    'Download',
    'Heart',
    'House',
    'Info',
    'LogOut',
    'Mail',
    'Menu',
    'Plus',
    'Search',
    'Settings',
    'Star',
    'Trash',
    'User',
    'X',
  ];
</script>

{#if gallery}
  <div class="grid grid-cols-6 gap-4 p-2">
    {#each galleryNames as n (n)}
      <div class="flex flex-col items-center gap-1.5">
        <Icon name={n} size={24} ariaLabel={n} />
        <span class="text-xs text-muted-foreground">{n}</span>
      </div>
    {/each}
  </div>
{:else}
  <Icon {name} {size} />
{/if}
