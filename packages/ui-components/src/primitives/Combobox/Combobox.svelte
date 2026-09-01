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
    openOnClick = true,
    name,
    placeholder,
    portal,
    filterFn,
    children,
    onValueChange,
    onOpenChange,
    onCreate,
  }: ComboboxProps = $props();

  untrack(() => {
    if (allowCustom && restrict) {
      throw new Error('Combobox: allowCustom and restrict are mutually exclusive.');
    }
  });

  if (value === undefined) value = untrack(() => defaultValue);
  if (open === undefined) open = untrack(() => defaultOpen);

  let inputValue = $state('');
  let filterValue = $state('');
  let activeIndex = $state<number | null>(null);
  // Two anchor slots, not one, and the precedence between them is declared here
  // rather than negotiated between the components (issue: effect_update_depth).
  // A single slot forced whoever registered second to READ the slot to decide
  // whether it was allowed to write — an effect reading the state it assigns,
  // which loops the moment Svelte tracks that read. With a slot each, neither
  // component ever reads the anchor, so the cycle cannot be written.
  let fieldAnchorEl = $state<HTMLElement | null>(null);
  let inputAnchorEl = $state<HTMLElement | null>(null);

  // Sync inputValue to selected value's label on init
  const initialItem = untrack(() => items.find((i) => i.value === value));
  if (initialItem) inputValue = initialItem.label;

  // Keep the displayed label in sync when the value — or the items list — changes
  // from OUTSIDE the component (async-loaded options, a programmatically/seeded
  // value). The init above fires once, so without this an edit form that seeds its
  // value after mount, or whose options load async, shows a blank input. Guarded so
  // it never runs while the popup is open (can't clobber what the user is typing),
  // and it only fills from a matching item or clears on empty — an unmatched/custom
  // value is left as-is so allowCustom free-text survives.
  $effect(() => {
    if (open) return;
    const match = items.find((i) => i.value === value);
    if (match) {
      if (untrack(() => inputValue) !== match.label) inputValue = match.label;
    } else if (value === undefined || value === '') {
      if (untrack(() => inputValue) !== '') inputValue = '';
    }
  });

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
    openOnClick: () => openOnClick,
    portal: () => portal,
    placeholder: () => placeholder,
    listboxId,
    inputId,
    getOnCreate: () => onCreate,
    // A ComboboxField, when one wraps the input, is the wider box and so the
    // better thing to hang the popup off; the input is the fallback.
    anchorEl: () => fieldAnchorEl ?? inputAnchorEl,
    setFieldAnchorEl: (el) => {
      fieldAnchorEl = el;
    },
    setInputAnchorEl: (el) => {
      inputAnchorEl = el;
    },
  });

  COMBOBOX_CONTEXT.set(ctx);
</script>

{#if name}
  <input type="hidden" {name} value={value ?? ''} />
{/if}

{@render children?.()}
