<!-- spec: ui-spec-v04.md §3 v0.4 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { useId } from '../../lib/useId';
  import { COMBOBOX_CONTEXT, createComboboxState } from '../../headless/Combobox.headless.svelte';
  import type { ComboboxProps } from './Combobox.types';

  let {
    value = $bindable(),
    defaultValue,
    open = $bindable(),
    defaultOpen = false,
    items,
    allowCustom = false,
    restrict = false,
    name,
    placeholder,
    portal = 'body',
    filterFn,
    children,
    onValueChange,
    onOpenChange,
    onCreate,
  }: ComboboxProps = $props();

  if (allowCustom && restrict) {
    throw new Error('Combobox: allowCustom and restrict are mutually exclusive.');
  }

  if (value === undefined) value = defaultValue;
  if (open === undefined) open = defaultOpen;

  let inputValue = $state('');
  let filterValue = $state('');
  let activeIndex = $state<number | null>(null);

  // Sync inputValue to selected value's label on init
  const initialItem = items.find((i) => i.value === value);
  if (initialItem) inputValue = initialItem.label;

  const listboxId = useId('combobox-listbox');
  const inputId = useId('combobox-input');

  const ctx = createComboboxState({
    value: () => value,
    setValue: (v) => {
      value = v;
      if (v !== undefined) onValueChange?.(v);
    },
    open: () => open ?? false,
    setOpen: (v) => {
      open = v;
      onOpenChange?.(v);
    },
    inputValue: () => inputValue,
    setInputValue: (v) => {
      inputValue = v;
    },
    filterValue: () => filterValue,
    setFilterValue: (v) => {
      filterValue = v;
    },
    activeIndex: () => activeIndex,
    setActiveIndex: (v) => {
      activeIndex = v;
    },
    items: () => items,
    filterFn: () => filterFn,
    allowCustom: () => allowCustom,
    restrict: () => restrict,
    portal: () => portal ?? 'body',
    placeholder: () => placeholder,
    listboxId,
    inputId,
    getOnCreate: () => onCreate,
  });

  COMBOBOX_CONTEXT.set(ctx);
</script>

{#if name}
  <input type="hidden" {name} value={value ?? ''} />
{/if}

{@render children?.()}
