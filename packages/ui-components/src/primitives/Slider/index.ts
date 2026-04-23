// spec: SPEC.md §4 v0.3
export { default as Slider } from './Slider.svelte';
export { default as SliderTrack } from './SliderTrack.svelte';
export { default as SliderRange } from './SliderRange.svelte';
export { default as SliderThumb } from './SliderThumb.svelte';
export type {
  SliderProps,
  SliderTrackProps,
  SliderRangeProps,
  SliderThumbProps,
} from './Slider.types';
export { sliderRootVariants, sliderTrackVariants, sliderThumbVariants } from './Slider.variants';
