<!-- spec: ui-spec-v03.md §3 v0.3 -->
<script lang="ts">
  import { tick } from 'svelte';
  import { cn } from '../../lib/cn';
  import { SELECT_CONTEXT } from '../../headless/Select.headless.svelte';
  import {
    PORTAL_CONTAINER_CONTEXT,
    usePortalMount,
  } from '../../headless/PortalContainer.headless.svelte';
  import { useAnchoredPosition } from '../../headless/FloatingPosition.headless.svelte';
  import { selectContentVariants } from './Select.variants';
  import type { SelectContentProps } from './Select.types';

  let { class: className, children }: SelectContentProps = $props();

  const ctx = SELECT_CONTEXT.get();
  // Optional: present only when this Select is rendered inside a Dialog/Sheet.
  const portalContainer = PORTAL_CONTAINER_CONTEXT.getOptional();

  let listboxEl: HTMLElement | undefined = $state(undefined);
  let wrapperEl: HTMLDivElement | undefined = $state(undefined);

  // Portal: move wrapper to target after mount. By default that is the enclosing
  // Dialog/Sheet content when there is one — a body-portalled listbox inside a
  // modal is inert — and <body> otherwise.
  usePortalMount({
    el: () => wrapperEl,
    portal: () => ctx.portal,
    container: () => portalContainer?.el ?? null,
  });

  // Floating-UI positioning: anchor the popover to the trigger.
  useAnchoredPosition({ el: () => wrapperEl, anchor: () => ctx.triggerEl });

  // Close on outside click
  $effect(() => {
    if (!ctx.open) return;
    function handleOutside(e: PointerEvent) {
      const target = e.target as Node;
      if (wrapperEl?.contains(target) || ctx.triggerEl?.contains(target)) return;
      ctx.closeList(false);
    }
    document.addEventListener('pointerdown', handleOutside);
    return () => document.removeEventListener('pointerdown', handleOutside);
  });

  // On open: initialize active option, then focus the listbox
  $effect(() => {
    if (!ctx.open || !listboxEl) return;
    // tick() lets child SelectItem $effects run first (registering items)
    tick().then(() => {
      ctx.initializeOpen();
      listboxEl?.focus({ preventScroll: true });
    });
  });

  function handleKeydown(e: KeyboardEvent) {
    ctx.handleListboxKeydown(e);
  }
</script>

{#if ctx.open}
  <div bind:this={wrapperEl} class="z-popover" style="position: absolute; top: 0; left: 0;">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      bind:this={listboxEl}
      id={ctx.listboxId}
      role="listbox"
      tabindex="-1"
      aria-labelledby={ctx.triggerId}
      aria-activedescendant={ctx.activeOptionId}
      class={cn(selectContentVariants(), className)}
      onkeydown={handleKeydown}
    >
      {@render children?.()}
    </div>
  </div>
{/if}
