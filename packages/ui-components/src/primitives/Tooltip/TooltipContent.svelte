<!-- spec: SPEC.md §8.8 v0.2.6 -->
<script lang="ts">
  import { Tooltip } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import { TOOLTIP_CONTEXT } from '../../headless/Tooltip.headless.svelte';
  import { tooltipContentClass } from './Tooltip.variants';
  import type { TooltipContentProps } from './Tooltip.types';

  let { side = 'top', sideOffset = 4, class: className, children }: TooltipContentProps = $props();

  TOOLTIP_CONTEXT.get();
</script>

<Tooltip.Portal>
  <Tooltip.Content {side} {sideOffset} class={cn(tooltipContentClass, className)}>
    {@render children?.()}
  </Tooltip.Content>
</Tooltip.Portal>
