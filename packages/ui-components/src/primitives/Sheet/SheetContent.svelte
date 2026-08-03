<!-- spec: SPEC.md §5 v0.3 -->
<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import { SHEET_CONTEXT } from '../../headless/Sheet.headless.svelte';
  import { PORTAL_CONTAINER_CONTEXT } from '../../headless/PortalContainer.headless.svelte';
  import { sheetContentVariants, sheetOverlayClass } from './Sheet.variants';
  import type { SheetContentProps } from './Sheet.types';

  let { class: className, children }: SheetContentProps = $props();

  const ctx = SHEET_CONTEXT.get();

  const portalTo = $derived(ctx.portal === false ? 'body' : (ctx.portal as string | HTMLElement));
  const portalDisabled = $derived(ctx.portal === false);
  const side = $derived(ctx.side);

  // Dropdowns opened inside this sheet portal in HERE, not to <body> — the modal
  // dialog underneath makes <body> inert. The base class carries no overflow, so
  // this element is also outside whatever scrolling region the host nests below
  // it, and nothing clips them.
  let contentEl = $state<HTMLElement | null>(null);
  PORTAL_CONTAINER_CONTEXT.set({
    get el() {
      return contentEl;
    },
  });
</script>

<Dialog.Portal to={portalTo} disabled={portalDisabled}>
  <Dialog.Overlay class={sheetOverlayClass} />
  <Dialog.Content bind:ref={contentEl} class={cn(sheetContentVariants({ side }), className)}>
    {@render children?.()}
  </Dialog.Content>
</Dialog.Portal>
