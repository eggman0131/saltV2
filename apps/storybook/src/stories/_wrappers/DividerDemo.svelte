<!-- Divider showcase wrapper for Divider.stories.ts. Both orientations need
     surrounding content/framing to be visible — a horizontal rule needs width,
     a vertical rule needs a fixed-height flex row. Rule 7: only
     @salt/ui-components. -->
<script lang="ts">
  import { Divider } from '@salt/ui-components';
  import type { DividerProps } from '@salt/ui-components';

  let { orientation = 'horizontal' }: { orientation?: DividerProps['orientation'] } = $props();
</script>

{#if orientation === 'vertical'}
  <div class="flex h-8 items-center gap-4 text-sm">
    <span>Recipes</span>
    <Divider orientation="vertical" />
    <span>Shopping</span>
    <Divider orientation="vertical" />
    <span>Planner</span>
  </div>
{:else}
  <div class="w-64 text-sm">
    <span>Above the divider</span>
    <Divider orientation="horizontal" class="my-3" />
    <span>Below the divider</span>
  </div>
{/if}
