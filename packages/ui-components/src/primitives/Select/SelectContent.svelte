<!-- spec: SPEC.md §3 v0.3 -->
<script lang="ts">
  import { tick } from 'svelte';
  import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';
  import { cn } from '../../lib/cn';
  import { SELECT_CONTEXT } from '../../headless/Select.headless.svelte';
  import {
    PORTAL_CONTAINER_CONTEXT,
    resolvePortalTarget,
  } from '../../headless/PortalContainer.headless.svelte';
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
  $effect(() => {
    const el = wrapperEl;
    if (!el) return;

    const target = resolvePortalTarget(ctx.portal, portalContainer?.el ?? null);
    if (!target) return;

    target.appendChild(el);
    return () => el.remove();
  });

  // Floating-UI positioning: anchor the popover to the trigger.
  $effect(() => {
    const el = wrapperEl;
    const anchor = ctx.triggerEl;
    if (!el || !anchor) return;

    return autoUpdate(anchor, el, () => {
      void computePosition(anchor, el, {
        placement: 'bottom-start',
        middleware: [
          offset(4),
          flip({ padding: 8 }),
          shift({ padding: 8 }),
          size({
            apply({ rects, elements, availableHeight }) {
              elements.floating.style.minWidth = `${rects.reference.width}px`;
              elements.floating.style.maxHeight = `${Math.max(120, availableHeight - 8)}px`;
              elements.floating.style.overflowY = 'auto';
            },
          }),
        ],
      }).then(({ x, y }) => {
        Object.assign(el.style, {
          position: 'absolute',
          left: '0',
          top: '0',
          transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)`,
        });
      });
    });
  });

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
