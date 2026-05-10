<!-- spec: SPEC.md §8.8 v0.2.3 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Tooltip } from 'bits-ui';
  import { TOOLTIP_CONTEXT, createTooltipState } from '../../headless/Tooltip.headless.svelte';
  import type { TooltipProps } from './Tooltip.types';

  let {
    open = $bindable(),
    defaultOpen = false,
    delayDuration = 700,
    disableHoverableContent = false,
    children,
    onOpenChange,
  }: TooltipProps = $props();

  if (open === undefined) open = untrack(() => defaultOpen);

  const state = createTooltipState();
  TOOLTIP_CONTEXT.set(state);

  function handleOpenChange(next: boolean) {
    open = next;
    onOpenChange?.(next);
  }
</script>

<!-- Embed Provider so Tooltip.Root works standalone; TooltipProvider.svelte is for app-level shared config -->
<Tooltip.Provider {delayDuration} {disableHoverableContent}>
  <Tooltip.Root open={open ?? false} onOpenChange={handleOpenChange} {delayDuration} {disableHoverableContent}>
    {@render children?.()}
  </Tooltip.Root>
</Tooltip.Provider>
