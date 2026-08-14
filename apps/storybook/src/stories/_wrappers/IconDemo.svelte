<!-- Icon showcase wrapper for Icon.stories.ts. A single Icon `component` can't
     express the Gallery grid, so this wrapper drives both: `gallery=false`
     renders one Icon (name/size stay live controls); `gallery=true` renders the
     whole registered icon set. Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { Icon, iconNames } from '@salt/ui-components';
  import type { IconProps } from '@salt/ui-components';

  let {
    name = 'ChefHat',
    size = 24,
    gallery = false,
  }: {
    name?: IconProps['name'];
    size?: number;
    gallery?: boolean;
  } = $props();

  // The gallery renders the Icon primitive's own registry (issue #813) rather
  // than a hand-list: a second list of names would be a second thing to drift,
  // and registering icons the app never uses purely to fill a story would bloat
  // the shipped bundle. This grid is Salt's real icon set, for free.
</script>

{#if gallery}
  <div class="grid grid-cols-6 gap-4 p-2">
    {#each iconNames as n (n)}
      <div class="flex flex-col items-center gap-1.5">
        <Icon name={n} size={24} ariaLabel={n} />
        <span class="text-xs text-muted-foreground">{n}</span>
      </div>
    {/each}
  </div>
{:else}
  <Icon {name} {size} />
{/if}
