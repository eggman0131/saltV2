<!-- spec: ui-spec-v04.md §5.4, §8.6 v0.4 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { COMBOBOX_CONTEXT } from '../../headless/Combobox.headless.svelte';
  import { comboboxCreateVariants } from './Combobox.variants';
  import type { ComboboxCreateProps } from './Combobox.types';

  let { class: className, children }: ComboboxCreateProps = $props();

  const ctx = COMBOBOX_CONTEXT.get();

  let el: HTMLElement | undefined = $state(undefined);

  // Index of ComboboxCreate is always filteredItems.length
  const createIndex = $derived(ctx.filteredItems.length);
  const isActive = $derived(ctx.isActive(createIndex));

  // Scroll into view when active
  $effect(() => {
    if (isActive && el) {
      el.scrollIntoView?.({ block: 'nearest' });
    }
  });

  function handleClick() {
    ctx.createCustom();
  }

  function handlePointerMove() {
    ctx.setActiveIndex(createIndex);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      ctx.createCustom();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={el}
  id={ctx.getItemId(createIndex)}
  role="option"
  aria-selected={false}
  tabindex={-1}
  class={cn(comboboxCreateVariants({ active: isActive }), className)}
  onclick={handleClick}
  onkeydown={handleKeydown}
  onpointermove={handlePointerMove}
>
  {#if children}
    {@render children()}
  {:else}
    Create "{ctx.inputValue}"
  {/if}
</div>
