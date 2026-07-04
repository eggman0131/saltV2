<!-- Inline (horizontal flex) demo. The full-width, fixed-height frame makes
     `justify` (main/horizontal axis) visible; the varied box heights make
     `align` (cross/vertical axis) visible. Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { Inline } from '@salt/ui-components';
  import type { InlineProps } from '@salt/ui-components';

  let {
    gap = '4',
    align = 'stretch',
    justify = 'start',
  }: {
    gap?: InlineProps['gap'];
    align?: InlineProps['align'];
    justify?: InlineProps['justify'];
  } = $props();
</script>

<div class="w-full rounded border border-dashed border-border p-2">
  <Inline {gap} {align} {justify} class="h-24 w-full">
    <div class="flex h-10 items-center rounded bg-muted px-3 text-sm text-muted-foreground">
      One
    </div>
    <div class="flex h-16 items-center rounded bg-muted px-3 text-sm text-muted-foreground">
      Two
    </div>
    <div class="flex h-12 items-center rounded bg-muted px-3 text-sm text-muted-foreground">
      Three
    </div>
  </Inline>
</div>
