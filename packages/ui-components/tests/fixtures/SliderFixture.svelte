<!-- spec: SPEC.md §6 v0.3 — test fixture for Slider composition -->
<script lang="ts">
  import Slider from '../../src/primitives/Slider/Slider.svelte';
  import SliderTrack from '../../src/primitives/Slider/SliderTrack.svelte';
  import SliderRange from '../../src/primitives/Slider/SliderRange.svelte';
  import SliderThumb from '../../src/primitives/Slider/SliderThumb.svelte';

  let {
    value = $bindable<number | [number, number]>(),
    defaultValue,
    min = 0,
    max = 100,
    step = 1,
    orientation = 'horizontal',
    disabled = false,
    isRange = false,
    onValueChange,
  }: {
    value?: number | [number, number];
    defaultValue?: number | [number, number];
    min?: number;
    max?: number;
    step?: number;
    orientation?: 'horizontal' | 'vertical';
    disabled?: boolean;
    isRange?: boolean;
    onValueChange?: (value: number | [number, number]) => void;
  } = $props();
</script>

<Slider bind:value {defaultValue} {min} {max} {step} {orientation} {disabled} {onValueChange}>
  <SliderTrack>
    <SliderRange />
    <SliderThumb />
    {#if isRange}
      <SliderThumb />
    {/if}
  </SliderTrack>
</Slider>
