<!-- Composition wrapper for Tooltip.stories.ts. Tooltip is a compound overlay
     (root + TooltipTrigger + TooltipContent). The root SELF-EMBEDS its Provider,
     so no external TooltipProvider is needed here. A controlled `open` control
     forces the tooltip visible for a static snapshot (otherwise it opens on
     hover/focus after `delayDuration`). Tooltip content renders on an inverted
     (dark) surface by design. Rule 7: only @salt/ui-components. -->
<script lang="ts">
  import { Tooltip, TooltipTrigger, TooltipContent, Button } from '@salt/ui-components';

  let {
    open = false,
    side = 'top',
    content = 'Adds this item to the shared shopping list',
  }: {
    open?: boolean;
    side?: 'top' | 'right' | 'bottom' | 'left';
    content?: string;
  } = $props();
</script>

<!-- Padding gives the (force-)open tooltip room to render around the trigger. -->
<div class="flex justify-center p-16">
  <Tooltip {open}>
    <TooltipTrigger>
      <Button variant="outline" size="sm">Hover me</Button>
    </TooltipTrigger>
    <TooltipContent {side}>{content}</TooltipContent>
  </Tooltip>
</div>
