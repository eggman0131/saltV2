// spec: SPEC.md §8.3 v0.2.3
import type { HTMLTextareaAttributes } from 'svelte/elements';
import type { TextareaFrameVariants } from './Textarea.variants';

export type TextareaProps = {
  value?: string;
  defaultValue?: string;
  label: string;
  description?: string;
  error?: string;
  placeholder?: string;
  size?: TextareaFrameVariants['size'];
  rows?: number;
  autoresize?: boolean;
  maxLength?: number;
  disabled?: boolean;
  readonly?: boolean;
  required?: boolean;
  name?: string;
  id?: string;
  class?: string;
  onValueChange?: (value: string) => void;
  onfocus?: HTMLTextareaAttributes['onfocus'];
  onblur?: HTMLTextareaAttributes['onblur'];
} & Omit<
  HTMLTextareaAttributes,
  | 'class'
  | 'value'
  | 'id'
  | 'name'
  | 'disabled'
  | 'readonly'
  | 'required'
  | 'placeholder'
  | 'rows'
  | 'maxlength'
  | 'onfocus'
  | 'onblur'
>;
