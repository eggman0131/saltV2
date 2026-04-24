<!-- spec: SPEC.md §3 v0.3 -->
<script lang="ts">
  import { untrack } from 'svelte';
  import { useId } from '../../lib/useId';
  import {
    SELECT_CONTEXT,
    createSelectState,
    type SelectRegisteredItem,
  } from '../../headless/Select.headless.svelte';
  import type { SelectProps } from './Select.types';

  let {
    value = $bindable(),
    defaultValue,
    open = $bindable(),
    defaultOpen = false,
    disabled = false,
    required = false,
    name,
    placeholder,
    portal = 'body',
    class: _className,
    children,
    onValueChange,
    onOpenChange,
  }: SelectProps = $props();

  if (value === undefined) value = untrack(() => defaultValue);
  if (open === undefined) open = untrack(() => defaultOpen);

  let items = $state.raw<SelectRegisteredItem[]>([]);
  let activeOption = $state<string | undefined>(undefined);
  let triggerEl = $state<HTMLElement | undefined>(undefined);
  let typeaheadBuffer = $state('');
  let typeaheadTimer = $state<ReturnType<typeof setTimeout> | undefined>(undefined);

  const listboxId = useId('select-listbox');
  const triggerId = useId('select-trigger');

  const ctx = createSelectState({
    value: () => value,
    setValue: (v) => {
      value = v;
      onValueChange?.(v);
    },
    open: () => open ?? false,
    setOpen: (v) => {
      open = v;
      onOpenChange?.(v);
    },
    disabled: () => disabled,
    required: () => required,
    placeholder: () => placeholder,
    portal: () => portal ?? 'body',
    listboxId,
    triggerId,
    getItems: () => items,
    addItem: (item) => {
      const current = untrack(() => items);
      const idx = current.findIndex((i) => i.value === item.value);
      if (idx !== -1) {
        items = current.map((existing, j) => (j === idx ? item : existing));
      } else {
        items = [...current, item];
      }
    },
    removeItem: (val) => {
      items = untrack(() => items).filter((i) => i.value !== val);
    },
    getActiveOption: () => activeOption,
    setActiveOption: (val) => {
      activeOption = val;
    },
    getTriggerEl: () => triggerEl,
    setTriggerEl: (el) => {
      triggerEl = el;
    },
    getTypeaheadBuffer: () => typeaheadBuffer,
    setTypeaheadBuffer: (v) => {
      typeaheadBuffer = v;
    },
    getTypeaheadTimer: () => typeaheadTimer,
    setTypeaheadTimer: (v) => {
      typeaheadTimer = v;
    },
  });

  SELECT_CONTEXT.set(ctx);
</script>

{#if name}
  <input type="hidden" {name} value={value ?? ''} />
{/if}

{@render children?.()}
