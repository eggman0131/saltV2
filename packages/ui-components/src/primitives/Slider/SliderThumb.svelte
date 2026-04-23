<!-- spec: SPEC.md §4 v0.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { SLIDER_CONTEXT } from '../../headless/Slider.headless.svelte';
  import { sliderThumbVariants } from './Slider.variants';
  import type { SliderThumbProps } from './Slider.types';

  let { class: className }: SliderThumbProps = $props();

  const ctx = SLIDER_CONTEXT.get();

  // Claim a sequential index during initialization (thumbs mount in render order)
  const thumbIdx = ctx.claimThumbIndex();

  const thumbValue = $derived(ctx.getThumbValue(thumbIdx));
  const percent = $derived(ctx.percentForThumb(thumbIdx));

  // In range mode, only the active thumb is in the tab sequence
  const isTabStop = $derived(!ctx.isRange || ctx.activeThumbIdx === thumbIdx);

  // Internal a11y label — APG slider requires an accessible name on each thumb
  const ariaLabel = $derived(ctx.isRange ? (thumbIdx === 0 ? 'Minimum' : 'Maximum') : 'Slider');

  // §2.3 exception: inline style for numeric positioning of the thumb
  const thumbStyle = $derived(
    ctx.orientation === 'horizontal'
      ? `left: ${percent}%; top: 50%; transform: translate(-50%, -50%);`
      : `bottom: ${percent}%; left: 50%; transform: translate(-50%, 50%);`,
  );

  function handleKeydown(e: KeyboardEvent) {
    ctx.handleThumbKeydown(e, thumbIdx);
  }

  function handleFocus() {
    ctx.setActiveThumbIdx(thumbIdx);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  role="slider"
  tabindex={isTabStop ? 0 : -1}
  aria-valuemin={ctx.min}
  aria-valuemax={ctx.max}
  aria-valuenow={thumbValue}
  aria-orientation={ctx.orientation}
  aria-disabled={ctx.disabled || undefined}
  aria-label={ariaLabel}
  class={cn(sliderThumbVariants({ disabled: ctx.disabled }), className)}
  style={thumbStyle}
  onkeydown={handleKeydown}
  onfocus={handleFocus}
></div>
