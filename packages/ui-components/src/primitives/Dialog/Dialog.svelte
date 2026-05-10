<!-- spec: SPEC.md §8.6 v0.2.3 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { Dialog } from 'bits-ui';
  import { DIALOG_CONTEXT, createDialogState } from '../../headless/Dialog.headless.svelte';
  import type { DialogProps } from './Dialog.types';

  let {
    open = $bindable(),
    defaultOpen = false,
    portal = 'body',
    class: _className,
    children,
    onOpenChange,
  }: DialogProps = $props();

  if (open === undefined) open = untrack(() => defaultOpen);

  const state = createDialogState({ portal: () => portal ?? 'body' });
  DIALOG_CONTEXT.set(state);

  function handleOpenChange(next: boolean) {
    open = next;
    onOpenChange?.(next);
  }
</script>

<Dialog.Root open={open ?? false} onOpenChange={handleOpenChange}>
  {@render children?.()}
</Dialog.Root>
