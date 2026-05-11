<!-- spec: SPEC.md §8.7 v0.2.3 -->
<script lang="ts">
  import { Popover } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import { POPOVER_CONTEXT } from '../../headless/Popover.headless.svelte';
  import { popoverContentClass } from './Popover.variants';
  import type { PopoverContentProps } from './Popover.types';

  let {
    side = 'bottom',
    align = 'center',
    sideOffset = 4,
    class: className,
    children,
  }: PopoverContentProps = $props();

  const ctx = POPOVER_CONTEXT.get();

  const portalTo = $derived(ctx.portal === false ? 'body' : (ctx.portal as string | HTMLElement));
  const portalDisabled = $derived(ctx.portal === false);
</script>

<Popover.Portal to={portalTo} disabled={portalDisabled}>
  <Popover.Content {side} {align} {sideOffset} class={cn(popoverContentClass, className)}>
    {@render children?.()}
  </Popover.Content>
</Popover.Portal>
