// spec: SPEC.md §4 v0.3
import type { Snippet } from 'svelte';

export type SliderProps = {
  value?: number | [number, number];
  defaultValue?: number | [number, number];
  min?: number;
  max?: number;
  step?: number;
  orientation?: 'horizontal' | 'vertical';
  disabled?: boolean;
  class?: string;
  children?: Snippet;
  onValueChange?: (value: number | [number, number]) => void;
};

export type SliderTrackProps = {
  class?: string;
  children?: Snippet;
};

export type SliderRangeProps = {
  class?: string;
};

export type SliderThumbProps = {
  class?: string;
};
