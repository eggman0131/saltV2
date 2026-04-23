<!-- spec: SPEC.md §2 v0.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { RADIO_GROUP_CONTEXT } from '../../headless/RadioGroup.headless.svelte';
  import { radioGroupItemVariants, radioGroupIndicatorVariants } from './RadioGroup.variants';
  import type { RadioGroupItemProps } from './RadioGroup.types';

  let {
    value,
    label,
    disabled = false,
    class: className,
    children,
  }: RadioGroupItemProps = $props();

  const ctx = RADIO_GROUP_CONTEXT.get();

  const effectiveDisabled = $derived(disabled || ctx.disabled);
  const isSelected = $derived(ctx.isSelected(value));
  const isTabStop = $derived(ctx.isTabStop(value));

  let el: HTMLDivElement | undefined = $state(undefined);

  $effect(() => {
    if (!el) return;
    ctx.registerItem(value, el, effectiveDisabled);
    return () => ctx.unregisterItem(value);
  });

  function handleClick() {
    if (!effectiveDisabled) {
      ctx.select(value);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    ctx.handleItemKeydown(e, value);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={el}
  role="radio"
  aria-checked={isSelected ? 'true' : 'false'}
  tabindex={isTabStop ? 0 : -1}
  aria-disabled={effectiveDisabled || undefined}
  class={cn(radioGroupItemVariants({ disabled: effectiveDisabled }), className)}
  onclick={handleClick}
  onkeydown={handleKeydown}
>
  <span aria-hidden="true" class={cn(radioGroupIndicatorVariants({ checked: isSelected }))}>
    {#if isSelected}
      <span class="h-2 w-2 rounded-full bg-primary-foreground"></span>
    {/if}
  </span>

  {#if label}
    <span class="text-sm text-foreground">{label}</span>
  {/if}

  {@render children?.()}
</div>
