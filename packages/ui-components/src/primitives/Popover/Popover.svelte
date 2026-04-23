<!-- spec: SPEC.md §8.7 v0.2.3 -->
<script lang="ts">
  import { Popover } from 'bits-ui';
  import { POPOVER_CONTEXT, createPopoverState } from '../../headless/Popover.headless.svelte';
  import type { PopoverProps } from './Popover.types';

  let {
    open = $bindable(),
    defaultOpen = false,
    portal = 'body',
    trapFocus = false,
    class: _className,
    children,
    onOpenChange,
  }: PopoverProps = $props();

  if (open === undefined) open = defaultOpen;

  const state = createPopoverState({
    portal: () => portal ?? 'body',
    trapFocus: () => trapFocus ?? false,
  });
  POPOVER_CONTEXT.set(state);

  function handleOpenChange(next: boolean) {
    open = next;
    onOpenChange?.(next);
  }
</script>

<Popover.Root {open} onOpenChange={handleOpenChange}>
  {@render children?.()}
</Popover.Root>
