// spec: SPEC.md §2 v0.3
import type { Snippet } from 'svelte';

export type RadioGroupProps = {
  value?: string;
  defaultValue?: string;
  name?: string;
  orientation?: 'horizontal' | 'vertical';
  disabled?: boolean;
  required?: boolean;
  label: string;
  description?: string;
  error?: string;
  class?: string;
  children?: Snippet;
  onValueChange?: (value: string) => void;
};

export type RadioGroupItemProps = {
  value: string;
  label?: string;
  disabled?: boolean;
  class?: string;
  children?: Snippet;
};
