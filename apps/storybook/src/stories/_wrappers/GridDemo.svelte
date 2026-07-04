<!-- Grid needs children to demonstrate its column/gap layout. This wrapper is
     the story `component` so cols/gap stay live Storybook controls. Rule 7. -->
<script lang="ts">
  import { Grid } from '@salt/ui-components';
  import type { GridProps } from '@salt/ui-components';

  let { cols = 3, gap = '4' }: { cols?: GridProps['cols']; gap?: GridProps['gap'] } = $props();

  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
</script>

<Grid {cols} {gap}>
  {#each items as n (n)}
    <div
      class="flex h-12 items-center justify-center rounded bg-muted text-sm text-muted-foreground"
    >
      {n}
    </div>
  {/each}
</Grid>
