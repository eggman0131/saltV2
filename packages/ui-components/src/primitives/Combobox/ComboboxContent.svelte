<!-- spec: ui-spec-v04.md §5.2 v0.4 -->
<script lang="ts">
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

  function handleMousedown(e: MouseEvent) {
    // Prevent input blur when clicking inside the popup
    e.preventDefault();
  }
</script>

{#if ctx.open}
  <div bind:this={wrapperEl} class="relative z-50">
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
