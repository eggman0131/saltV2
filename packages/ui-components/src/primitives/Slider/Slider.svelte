<!-- spec: SPEC.md §4 v0.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { SLIDER_CONTEXT, createSliderState } from '../../headless/Slider.headless.svelte';
  import { sliderRootVariants } from './Slider.variants';
  import type { SliderProps } from './Slider.types';

  let {
    value = $bindable<number | [number, number]>(),
    defaultValue,
    min = 0,
    max = 100,
    step = 1,
    orientation = 'horizontal',
    disabled = false,
    class: className,
    children,
    onValueChange,
  }: SliderProps = $props();

  // Canonical §3.6 seed — reads defaultValue once, intentionally non-reactive
  if (value === undefined) value = defaultValue ?? 0;

  let activeThumbIdx = $state(0);

  // Per-instance counter; claims sequential thumb indices as thumbs initialize
  let thumbIdxCounter = 0;

  const sliderState = createSliderState({
    value: () => value as number | [number, number],
    setValue: (v) => {
      value = v;
      onValueChange?.(v);
    },
    min: () => min,
    max: () => max,
    step: () => step,
    orientation: () => orientation,
    disabled: () => disabled,
    getActiveThumb: () => activeThumbIdx,
    setActiveThumb: (idx) => {
      activeThumbIdx = idx;
    },
    claimThumbIndex: () => thumbIdxCounter++,
  });

  SLIDER_CONTEXT.set(sliderState);
</script>

<div
  class={cn(sliderRootVariants({ orientation, disabled }), className)}
  data-disabled={disabled || undefined}
  data-orientation={orientation}
>
  {@render children?.()}
</div>
