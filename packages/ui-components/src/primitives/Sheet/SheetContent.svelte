<!-- spec: SPEC.md §5 v0.3 -->
<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import { SHEET_CONTEXT } from '../../headless/Sheet.headless.svelte';
  import { sheetContentVariants, sheetOverlayClass } from './Sheet.variants';
  import type { SheetContentProps } from './Sheet.types';

  let { class: className, children }: SheetContentProps = $props();

  const ctx = SHEET_CONTEXT.get();

  const portalTo = $derived(
    ctx.portal === false ? 'body' : (ctx.portal as string | HTMLElement),
  );
  const portalDisabled = $derived(ctx.portal === false);
  const side = $derived(ctx.side);
</script>

<Dialog.Portal to={portalTo} disabled={portalDisabled}>
  <Dialog.Overlay class={sheetOverlayClass} />
  <Dialog.Content class={cn(sheetContentVariants({ side }), className)}>
    {@render children?.()}
  </Dialog.Content>
</Dialog.Portal>
