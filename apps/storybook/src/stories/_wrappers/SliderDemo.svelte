<!-- Composition wrapper for Slider.stories.ts. Slider is a compound component
     (root + SliderTrack > SliderRange + one-or-two SliderThumb) wired through
     context, so a single `component` + `args` cannot express it. A `range` boolean
     switches between a single value + one thumb and a [min,max] tuple + two thumbs.
     Vertical orientation needs a fixed-height parent. Rule 7: only
     @salt/ui-components. -->
<script lang="ts">
  import { Slider, SliderTrack, SliderRange, SliderThumb } from '@salt/ui-components';

  let {
    range = false,
    disabled = false,
    orientation = 'horizontal',
    min = 0,
    max = 100,
    step = 1,
  }: {
    range?: boolean;
    disabled?: boolean;
    orientation?: 'horizontal' | 'vertical';
    min?: number;
    max?: number;
    step?: number;
  } = $props();

  const rangeValue: [number, number] = [25, 75];
  const singleValue = 50;
</script>

<div class={orientation === 'vertical' ? 'h-48' : 'w-64'}>
  <Slider value={range ? rangeValue : singleValue} {min} {max} {step} {orientation} {disabled}>
    <SliderTrack>
      <SliderRange />
    </SliderTrack>
    <SliderThumb />
    {#if range}
      <SliderThumb />
    {/if}
  </Slider>
</div>
