// spec: SPEC.md §8.2 v0.2.3
import type { Snippet } from 'svelte';
import type { HTMLInputAttributes } from 'svelte/elements';
import type { TextFieldFrameVariants } from './TextField.variants';

export type TextFieldProps = {
  value?: string;
  defaultValue?: string;
  // Optional per SPEC §8.2: when omitted, the caller must supply `aria-label`
  // or `aria-labelledby` (both flow through `...rest` onto the <input>). The
  // component already guards `{#if label}` — this type matches that contract.
  label?: string;
  description?: string;
  // `| undefined` (SPEC §8.2: `string | undefined`) so callers can pass a
  // conditional error (`hasError ? msg : undefined`) under
  // exactOptionalPropertyTypes; empty/undefined both render no error.
  error?: string | undefined;
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
