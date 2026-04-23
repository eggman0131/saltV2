// spec: SPEC.md §8.15 v0.2.3

export type ProgressProps = {
  value?: number;
  defaultValue?: number;
  max?: number;
  announce?: 'polite' | 'off';
  ariaLabel?: string;
  class?: string;
};
