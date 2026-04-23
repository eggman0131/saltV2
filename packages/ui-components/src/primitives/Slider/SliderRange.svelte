<!-- spec: SPEC.md §4 v0.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { SLIDER_CONTEXT } from '../../headless/Slider.headless.svelte';
  import type { SliderRangeProps } from './Slider.types';

  let { class: className }: SliderRangeProps = $props();

  const ctx = SLIDER_CONTEXT.get();

  // §2.3 exception: inline style for numeric transforms/positioning
  const rangeStyle = $derived.by(() => {
    const p0 = ctx.percentForThumb(0);
    if (ctx.isRange) {
      const p1 = ctx.percentForThumb(1);
      return ctx.orientation === 'horizontal'
        ? `left: ${p0}%; width: ${p1 - p0}%;`
        : `bottom: ${p0}%; height: ${p1 - p0}%;`;
    }
    return ctx.orientation === 'horizontal'
      ? `left: 0%; width: ${p0}%;`
      : `bottom: 0%; height: ${p0}%;`;
  });
</script>

<!-- inset-y-0 / inset-x-0 keeps range flush with track edges in cross-axis -->
<div
  class={cn(
    'absolute rounded-full bg-primary',
    ctx.orientation === 'horizontal' ? 'inset-y-0' : 'inset-x-0',
    className,
  )}
  data-orientation={ctx.orientation}
  style={rangeStyle}
></div>
