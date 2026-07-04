<!-- Stack (vertical flex) demo. The dashed, fixed-height frame makes `justify`
     (main/vertical axis) visible; the varied box widths make `align`
     (cross/horizontal axis) visible. Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { Stack } from '@salt/ui-components';
  import type { StackProps } from '@salt/ui-components';

  let {
    gap = '4',
    align = 'stretch',
    justify = 'start',
  }: {
    gap?: StackProps['gap'];
    align?: StackProps['align'];
    justify?: StackProps['justify'];
  } = $props();
</script>

<div class="h-64 w-64 rounded border border-dashed border-border p-2">
  <Stack {gap} {align} {justify} class="h-full">
    <div class="w-16 rounded bg-muted px-3 py-2 text-sm text-muted-foreground">One</div>
    <div class="w-32 rounded bg-muted px-3 py-2 text-sm text-muted-foreground">Two</div>
    <div class="w-24 rounded bg-muted px-3 py-2 text-sm text-muted-foreground">Three</div>
  </Stack>
</div>
