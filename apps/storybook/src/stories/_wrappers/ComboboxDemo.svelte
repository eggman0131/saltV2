<!-- Composition wrapper for Combobox.stories.ts. Combobox is a context-driven
     compound (root + ComboboxField/Input/Trigger + ComboboxContent whose children
     snippet receives { filteredItems, showCreate }). `portal={false}` renders the
     dropdown inline in the canvas; `relative` gives the absolutely-positioned
     content an offset parent. Rule 7: only @salt/ui-components.

     NOTE: the live "Create …" row and the filtered/empty results are driven by
     the component's internal filter state, which is only reachable by TYPING into
     the input — and no @storybook/test is installed for a `play` fn. So we drive
     those states statically: `allowCustom` renders a representative <ComboboxCreate>
     row directly, and `empty` passes an empty item list so ComboboxEmpty shows. -->
<script lang="ts">
  import {
    Combobox,
    ComboboxField,
    ComboboxInput,
    ComboboxTrigger,
    ComboboxContent,
    ComboboxItem,
    ComboboxEmpty,
    ComboboxCreate,
    type ComboboxItemType,
  } from '@salt/ui-components';

  let {
    open = false,
    allowCustom = false,
    empty = false,
    placeholder = 'Search ingredients…',
  }: {
    open?: boolean;
    allowCustom?: boolean;
    empty?: boolean;
    placeholder?: string;
  } = $props();

  const allItems: ComboboxItemType[] = [
    { value: 'tomato', label: 'Tomato' },
    { value: 'onion', label: 'Onion' },
    { value: 'garlic', label: 'Garlic' },
    { value: 'basil', label: 'Basil' },
  ];

  const items = $derived(empty ? [] : allItems);
</script>

<div class="relative w-64">
  <Combobox {items} {open} {allowCustom} {placeholder} portal={false}>
    <ComboboxField>
      <ComboboxInput />
      <ComboboxTrigger />
    </ComboboxField>
    <ComboboxContent>
      {#snippet children({ filteredItems })}
        {#each filteredItems as item, i (item.value)}
          <ComboboxItem {item} index={i} />
        {/each}
        {#if filteredItems.length === 0}
          <ComboboxEmpty>No ingredients found</ComboboxEmpty>
        {/if}
        {#if allowCustom && filteredItems.length > 0}
          <ComboboxCreate>Create &ldquo;Cauliflower&rdquo;</ComboboxCreate>
        {/if}
      {/snippet}
    </ComboboxContent>
  </Combobox>
</div>
