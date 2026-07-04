<!-- Composition wrapper for Popover.stories.ts. Popover is a compound overlay
     (root + PopoverTrigger + PopoverContent) wired through context. Same
     force-open pattern as DialogDemo: a controlled `open` control + `portal={false}`
     so the floating content renders inline in the canvas. Rule 7: only
     @salt/ui-components. -->
<script lang="ts">
  import { Popover, PopoverTrigger, PopoverContent, Button } from '@salt/ui-components';

  let {
    open = false,
    side = 'bottom',
    align = 'center',
  }: {
    open?: boolean;
    side?: 'top' | 'right' | 'bottom' | 'left';
    align?: 'start' | 'center' | 'end';
  } = $props();
</script>

<Popover {open} portal={false}>
  <PopoverTrigger>
    <Button variant="outline">Open popover</Button>
  </PopoverTrigger>
  <PopoverContent {side} {align} class="w-56 p-4">
    <p class="text-sm">Popover content. Can hold any interactive elements.</p>
  </PopoverContent>
</Popover>
