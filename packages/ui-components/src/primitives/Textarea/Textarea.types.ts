// spec: ui-spec-v02.md §8.3 v0.2.3
import type { HTMLTextareaAttributes } from 'svelte/elements';
import type { TextareaFrameVariants } from './Textarea.variants';

export type TextareaProps = {
  value?: string;
  defaultValue?: string;
  // Optional per SPEC §8.3 (same contract as TextField §8.2): when omitted, the
  // caller must supply `aria-label`/`aria-labelledby`. The component guards
  // `{#if label}`, so this type matches the rendered behaviour.
  label?: string;
  description?: string;
  // `| undefined` (SPEC §8.3: `string | undefined`) so callers can pass a
  // conditional error (`hasError ? msg : undefined`) under
  // exactOptionalPropertyTypes; empty/undefined both render no error.
  error?: string | undefined;
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
  // Bindable handle on the underlying <textarea> (SPEC §8.3). Optional and
  // inert when unbound — the component uses the same reference internally for
  // autoresize either way. Bind it only to drive the DOM node directly
  // (selection ranges, `setRangeText`); read/write of the text itself stays on
  // `value`/`onValueChange`.
  element?: HTMLTextAreaElement | undefined;
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
