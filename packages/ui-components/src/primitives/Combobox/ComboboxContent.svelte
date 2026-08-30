<!-- spec: ui-spec-v04.md §5.2 v0.4 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { COMBOBOX_CONTEXT } from '../../headless/Combobox.headless.svelte';
  import {
    PORTAL_CONTAINER_CONTEXT,
    usePortalMount,
  } from '../../headless/PortalContainer.headless.svelte';
  import { useAnchoredPosition } from '../../headless/FloatingPosition.headless.svelte';
  import { comboboxContentVariants } from './Combobox.variants';
  import type { ComboboxContentProps } from './Combobox.types';

  let { class: className, children }: ComboboxContentProps = $props();

  const ctx = COMBOBOX_CONTEXT.get();
  // Optional: present only when this Combobox is rendered inside a Dialog/Sheet.
  const portalContainer = PORTAL_CONTAINER_CONTEXT.getOptional();

  let wrapperEl: HTMLDivElement | undefined = $state(undefined);

  // Portal: move wrapper to target after mount. By default that is the enclosing
  // Dialog/Sheet content when there is one — a body-portalled listbox inside a
  // modal is inert — and <body> otherwise.
  usePortalMount({
    el: () => wrapperEl,
    portal: () => ctx.portal,
    container: () => portalContainer?.el ?? null,
  });

  // Floating-UI positioning: anchor the popover to the input/field.
  useAnchoredPosition({ el: () => wrapperEl, anchor: () => ctx.anchorEl });

  function handleMousedown(e: MouseEvent) {
    // Prevent input blur when clicking inside the popup
    e.preventDefault();
  }
</script>

{#if ctx.open}
  <div bind:this={wrapperEl} class="z-popover" style="position: absolute; top: 0; left: 0;">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      id={ctx.listboxId}
      role="listbox"
      tabindex="-1"
      aria-activedescendant={ctx.getActiveDescendantId()}
      class={cn(comboboxContentVariants(), className)}
      onmousedown={handleMousedown}
    >
      {#if children}
        {@render children({ filteredItems: ctx.filteredItems, showCreate: ctx.showCreate })}
      {/if}
    </div>
  </div>
{/if}
