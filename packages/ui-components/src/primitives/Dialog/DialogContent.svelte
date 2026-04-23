<!-- spec: SPEC.md §8.6 v0.2.3 -->
<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import { DIALOG_CONTEXT } from '../../headless/Dialog.headless.svelte';
  import { dialogContentVariants, dialogOverlayClass } from './Dialog.variants';
  import type { DialogContentProps } from './Dialog.types';

  let { size = 'md', class: className, children }: DialogContentProps = $props();

  const ctx = DIALOG_CONTEXT.get();

  const portalTo = $derived(
    ctx.portal === false ? undefined : (ctx.portal as string | HTMLElement),
  );
  const portalDisabled = $derived(ctx.portal === false);
</script>

<Dialog.Portal to={portalTo} disabled={portalDisabled}>
  <Dialog.Overlay class={dialogOverlayClass} />
  <Dialog.Content class={cn(dialogContentVariants({ size }), className)}>
    {@render children?.()}
  </Dialog.Content>
</Dialog.Portal>
