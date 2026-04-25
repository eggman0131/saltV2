<!-- spec: ui-spec-v04.md §5.2 v0.4 -->
<script lang="ts">
  import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';
  import { cn } from '../../lib/cn';
  import { COMBOBOX_CONTEXT } from '../../headless/Combobox.headless.svelte';
  import { comboboxContentVariants } from './Combobox.variants';
  import type { ComboboxContentProps } from './Combobox.types';

  let { class: className, children }: ComboboxContentProps = $props();

  const ctx = COMBOBOX_CONTEXT.get();

  let wrapperEl: HTMLDivElement | undefined = $state(undefined);

  // Portal: move wrapper to target after mount
  $effect(() => {
    const el = wrapperEl;
    if (!el || ctx.portal === false) return;

    const target =
      typeof ctx.portal === 'string'
        ? ((document.querySelector(ctx.portal) as HTMLElement | null) ?? document.body)
        : ctx.portal;

    target.appendChild(el);
    return () => el.remove();
  });

  // Floating-UI positioning: anchor the popover to the input/field.
  $effect(() => {
    const el = wrapperEl;
    const anchor = ctx.anchorEl;
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

  function handleMousedown(e: MouseEvent) {
    // Prevent input blur when clicking inside the popup
    e.preventDefault();
  }
</script>

{#if ctx.open}
  <div bind:this={wrapperEl} class="z-50" style="position: absolute; top: 0; left: 0;">
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
