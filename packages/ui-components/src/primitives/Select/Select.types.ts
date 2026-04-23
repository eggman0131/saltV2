// spec: SPEC.md §3 v0.3
import type { Snippet } from 'svelte';

export type SelectProps = {
  value?: string;
  defaultValue?: string;
  open?: boolean;
  defaultOpen?: boolean;
  disabled?: boolean;
  required?: boolean;
  name?: string;
  placeholder?: string;
  portal?: HTMLElement | string | false;
  class?: string;
  children?: Snippet;
  onValueChange?: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
};

export type SelectTriggerProps = {
  class?: string;
  children?: Snippet;
};

export type SelectContentProps = {
  class?: string;
  children?: Snippet;
};

export type SelectItemProps = {
  value: string;
  label?: string;
  disabled?: boolean;
  class?: string;
  children?: Snippet;
};

export type SelectGroupProps = {
  class?: string;
  children?: Snippet;
};

export type SelectLabelProps = {
  class?: string;
  children?: Snippet;
};

export type SelectSeparatorProps = {
  class?: string;
};
