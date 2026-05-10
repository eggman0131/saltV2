// spec: SPEC.md §8.2 v0.2.3
import type { Snippet } from 'svelte';
import type { HTMLInputAttributes } from 'svelte/elements';
import type { TextFieldFrameVariants } from './TextField.variants';

export type TextFieldProps = {
  value?: string;
  defaultValue?: string;
  label: string;
  description?: string;
  error?: string;
  type?: 'text' | 'email' | 'password' | 'url' | 'tel' | 'search';
  placeholder?: string;
  size?: TextFieldFrameVariants['size'];
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  autocomplete?: string;
  name?: string;
  id?: string;
  class?: string;
  leading?: Snippet;
  trailing?: Snippet;
  onValueChange?: (value: string) => void;
  onfocus?: HTMLInputAttributes['onfocus'];
  onblur?: HTMLInputAttributes['onblur'];
} & Omit<
  HTMLInputAttributes,
  | 'class'
  | 'value'
  | 'type'
  | 'id'
  | 'name'
  | 'disabled'
  | 'readonly'
  | 'required'
  | 'autocomplete'
  | 'placeholder'
  | 'onfocus'
  | 'onblur'
  | 'size'
>;
