<!-- spec: ui-spec-v04.md §5.3 v0.4 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { COMBOBOX_CONTEXT } from '../../headless/Combobox.headless.svelte';
  import { comboboxItemVariants } from './Combobox.variants';
  import type { ComboboxItemProps } from './Combobox.types';

  let { item, index, class: className, children }: ComboboxItemProps = $props();

  const ctx = COMBOBOX_CONTEXT.get();

  let el: HTMLElement | undefined = $state(undefined);

  const isSelected = $derived(ctx.isSelected(item.value));
  const isActive = $derived(ctx.isActive(index));

  // Scroll into view when this item becomes active
  $effect(() => {
    if (isActive && el) {
      el.scrollIntoView?.({ block: 'nearest' });
    }
  });

  function handleClick() {
    ctx.selectItem(item.value);
  }

  function handlePointerMove() {
    ctx.setActiveIndex(index);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      ctx.selectItem(item.value);
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={el}
  id={ctx.getItemId(index)}
  role="option"
  aria-selected={isSelected}
  tabindex={-1}
  class={cn(comboboxItemVariants({ active: isActive }), className)}
  onclick={handleClick}
  onkeydown={handleKeydown}
  onpointermove={handlePointerMove}
>
  {#if children}
    {@render children()}
  {:else}
    {item.label}
  {/if}
</div>
