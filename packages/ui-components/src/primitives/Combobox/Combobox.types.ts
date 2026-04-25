// spec: ui-spec-v04.md §3 v0.4
import type { Snippet } from 'svelte';

export type ComboboxItem = { value: string; label: string };

export type ComboboxProps = {
  value?: string;
  defaultValue?: string;
  open?: boolean;
  defaultOpen?: boolean;
  items: ComboboxItem[];
  allowCustom?: boolean;
  restrict?: boolean;
  name?: string;
  placeholder?: string;
  portal?: HTMLElement | string | false;
  filterFn?: (input: string, item: ComboboxItem) => boolean;
  class?: string;
  children?: Snippet;
  onValueChange?: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  onCreate?: (value: string) => void;
};

export type ComboboxInputProps = {
  class?: string;
};

export type ComboboxFieldProps = {
  class?: string;
  children?: Snippet;
};

export type ComboboxTriggerProps = {
  class?: string;
  children?: Snippet;
};

export type ComboboxContentProps = {
  class?: string;
  children?: Snippet<[{ filteredItems: ComboboxItem[]; showCreate: boolean }]>;
};

export type ComboboxItemProps = {
  item: ComboboxItem;
  index: number;
  class?: string;
  children?: Snippet;
};

export type ComboboxGroupProps = {
  class?: string;
  children?: Snippet;
};

export type ComboboxLabelProps = {
  class?: string;
  children?: Snippet;
};

export type ComboboxSeparatorProps = {
  class?: string;
};

export type ComboboxEmptyProps = {
  class?: string;
  children?: Snippet;
};

export type ComboboxCreateProps = {
  class?: string;
  children?: Snippet;
};
