<!-- spec: ui-spec-v04.md §7 v0.4 — test fixture for Combobox composition -->
<script lang="ts">
  import Combobox from '../../src/primitives/Combobox/Combobox.svelte';
  import ComboboxField from '../../src/primitives/Combobox/ComboboxField.svelte';
  import ComboboxInput from '../../src/primitives/Combobox/ComboboxInput.svelte';
  import ComboboxTrigger from '../../src/primitives/Combobox/ComboboxTrigger.svelte';
  import ComboboxContent from '../../src/primitives/Combobox/ComboboxContent.svelte';
  import ComboboxItem from '../../src/primitives/Combobox/ComboboxItem.svelte';
  import ComboboxGroup from '../../src/primitives/Combobox/ComboboxGroup.svelte';
  import ComboboxLabel from '../../src/primitives/Combobox/ComboboxLabel.svelte';
  import ComboboxSeparator from '../../src/primitives/Combobox/ComboboxSeparator.svelte';
  import ComboboxEmpty from '../../src/primitives/Combobox/ComboboxEmpty.svelte';
  import ComboboxCreate from '../../src/primitives/Combobox/ComboboxCreate.svelte';
  import type { ComboboxItem as ComboboxItemType } from '../../src/primitives/Combobox/Combobox.types';

  const defaultItems: ComboboxItemType[] = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
    { value: 'cherry', label: 'Cherry' },
  ];

  let {
    value = $bindable<string | undefined>(undefined),
    defaultValue,
    open = $bindable<boolean | undefined>(undefined),
    defaultOpen,
    items = defaultItems,
    allowCustom = false,
    restrict = false,
    openOnClick = true,
    name,
    placeholder = 'Search…',
    portal = false,
    filterFn,
    onValueChange,
    onOpenChange,
    onCreate,
  }: {
    value?: string;
    defaultValue?: string;
    open?: boolean;
    defaultOpen?: boolean;
    items?: ComboboxItemType[];
    allowCustom?: boolean;
    restrict?: boolean;
    openOnClick?: boolean;
    name?: string;
    placeholder?: string;
    portal?: HTMLElement | string | false;
    filterFn?: (input: string, item: ComboboxItemType) => boolean;
    onValueChange?: (value: string) => void;
    onOpenChange?: (open: boolean) => void;
    onCreate?: (value: string) => void;
  } = $props();
</script>

<Combobox
  bind:value
  {defaultValue}
  bind:open
  {defaultOpen}
  {items}
  {allowCustom}
  {restrict}
  {openOnClick}
  {name}
  {placeholder}
  {portal}
  {filterFn}
  {onValueChange}
  {onOpenChange}
  {onCreate}
>
  <ComboboxField>
    <ComboboxInput />
    <ComboboxTrigger />
  </ComboboxField>
  <ComboboxContent>
    {#snippet children({ filteredItems, showCreate })}
      <ComboboxGroup>
        <ComboboxLabel>Fruits</ComboboxLabel>
        {#each filteredItems as item, i}
          <ComboboxItem {item} index={i} />
        {/each}
        <ComboboxSeparator />
      </ComboboxGroup>
      {#if filteredItems.length === 0}
        <ComboboxEmpty>No results found.</ComboboxEmpty>
      {/if}
      {#if showCreate}
        <ComboboxCreate />
      {/if}
    {/snippet}
  </ComboboxContent>
</Combobox>
