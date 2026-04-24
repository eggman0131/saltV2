<!-- spec: SPEC.md §5 v0.3 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Dialog } from 'bits-ui';
  import { SHEET_CONTEXT, createSheetState } from '../../headless/Sheet.headless.svelte';
  import type { SheetProps } from './Sheet.types';

  let {
    open = $bindable(),
    defaultOpen = false,
    side = 'right',
    portal = 'body',
    class: _className,
    children,
    onOpenChange,
  }: SheetProps = $props();

  if (open === undefined) open = untrack(() => defaultOpen);

  const state = createSheetState({
    portal: () => portal ?? 'body',
    side: () => side,
  });
  SHEET_CONTEXT.set(state);

  function handleOpenChange(next: boolean) {
    open = next;
    onOpenChange?.(next);
  }
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
  {@render children?.()}
</Dialog.Root>
