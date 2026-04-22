// spec: SPEC.md §8.4 v0.2.3
import type { Snippet } from 'svelte';
import type { CheckboxRootVariants } from './Checkbox.variants';

export type CheckedState = boolean | 'indeterminate';

export type CheckboxProps = {
  checked?: CheckedState;
  defaultChecked?: CheckedState;
  label?: string;
  labelledBy?: string;
  description?: string;
  error?: string;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  value?: string;
  size?: CheckboxRootVariants['size'];
  class?: string;
  children?: Snippet;
};
