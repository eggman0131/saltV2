<!-- spec: SPEC.md §4 v0.3 -->
<script lang="ts">
  import { cn } from '../../lib/cn';
  import { SLIDER_CONTEXT } from '../../headless/Slider.headless.svelte';
  import { sliderTrackVariants } from './Slider.variants';
  import type { SliderTrackProps } from './Slider.types';

  let { class: className, children }: SliderTrackProps = $props();

  const ctx = SLIDER_CONTEXT.get();

  let trackEl: HTMLDivElement | undefined = $state(undefined);

  function handlePointerDown(e: PointerEvent) {
    if (!trackEl) return;
    ctx.handleTrackPointerDown(e, trackEl);
  }
</script>

<div
  bind:this={trackEl}
  role="presentation"
  class={cn(sliderTrackVariants({ orientation: ctx.orientation }), className)}
  data-orientation={ctx.orientation}
  onpointerdown={handlePointerDown}
>
  {@render children?.()}
</div>
