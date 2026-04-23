<!-- spec: SPEC.md §3 v0.3 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { cn } from '../../lib/cn';
  import { useId } from '../../lib/useId';
  import { SELECT_CONTEXT } from '../../headless/Select.headless.svelte';
  import { selectItemVariants } from './Select.variants';
  import type { SelectItemProps } from './Select.types';

  let {
    value,
    label = value,
    disabled = false,
    class: className,
    children,
  }: SelectItemProps = $props();

  const ctx = SELECT_CONTEXT.get();
  const id = useId('select-option');

  let el: HTMLElement | undefined = $state(undefined);

  const isSelected = $derived(ctx.isSelected(value));
  const isActive = $derived(ctx.isActive(value));

  $effect(() => {
    if (!el) return;
    // Re-register whenever reactive props change
    const _label = label;
    const _disabled = disabled;
    untrack(() => ctx.registerItem({ value, label: _label, id, el: el!, disabled: _disabled }));
    return () => ctx.unregisterItem(value);
  });

  function handleClick() {
    if (!disabled) ctx.selectOption(value);
  }

  function handlePointerMove() {
    if (!disabled) ctx.setActive(value);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={el}
  {id}
  role="option"
  aria-selected={isSelected}
  aria-disabled={disabled || undefined}
  class={cn(selectItemVariants({ active: isActive, disabled }), className)}
  onclick={handleClick}
  onpointermove={handlePointerMove}
>
  {#if children}
    {@render children()}
  {:else}
    {label}
  {/if}
</div>
