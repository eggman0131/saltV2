<!-- spec: SPEC.md §8.6 v0.2.10 -->
<script lang="ts">
  import { Dialog } from 'bits-ui';
  import { cn } from '../../lib/cn';
  import { DIALOG_CONTEXT } from '../../headless/Dialog.headless.svelte';
  import { PORTAL_CONTAINER_CONTEXT } from '../../headless/PortalContainer.headless.svelte';
  import { dialogContentVariants, dialogOverlayClass } from './Dialog.variants';
  import type { DialogContentProps } from './Dialog.types';

  let { size = 'md', class: className, children }: DialogContentProps = $props();

  const ctx = DIALOG_CONTEXT.get();

  const portalTo = $derived(ctx.portal === false ? 'body' : (ctx.portal as string | HTMLElement));
  const portalDisabled = $derived(ctx.portal === false);

  // Dropdowns opened inside this dialog portal in HERE, not to <body>, which the
  // modal has made inert. Note the panel is `overflow-y-auto`: a dropdown is
  // therefore bounded by the dialog, and floating-ui's flip/shift/size keep it
  // inside rather than letting it spill past the edge.
  let contentEl = $state<HTMLElement | null>(null);
  PORTAL_CONTAINER_CONTEXT.set({
    get el() {
      return contentEl;
    },
  });
</script>

<Dialog.Portal to={portalTo} disabled={portalDisabled}>
  <Dialog.Overlay class={dialogOverlayClass} />
  <Dialog.Content bind:ref={contentEl} class={cn(dialogContentVariants({ size }), className)}>
    {@render children?.()}
  </Dialog.Content>
</Dialog.Portal>
