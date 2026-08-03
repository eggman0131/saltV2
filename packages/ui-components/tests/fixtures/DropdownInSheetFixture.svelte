<!-- spec: ui-spec-v02.md §2.5 v0.2.10 — test fixture for #674: a dropdown opened inside a Sheet -->
<script lang="ts">
  import Sheet from '../../src/primitives/Sheet/Sheet.svelte';
  import SheetContent from '../../src/primitives/Sheet/SheetContent.svelte';
  import SheetTitle from '../../src/primitives/Sheet/SheetTitle.svelte';
  import Select from '../../src/primitives/Select/Select.svelte';
  import SelectTrigger from '../../src/primitives/Select/SelectTrigger.svelte';
  import SelectContent from '../../src/primitives/Select/SelectContent.svelte';
  import SelectItem from '../../src/primitives/Select/SelectItem.svelte';
  import Combobox from '../../src/primitives/Combobox/Combobox.svelte';
  import ComboboxField from '../../src/primitives/Combobox/ComboboxField.svelte';
  import ComboboxInput from '../../src/primitives/Combobox/ComboboxInput.svelte';
  import ComboboxContent from '../../src/primitives/Combobox/ComboboxContent.svelte';
  import ComboboxItem from '../../src/primitives/Combobox/ComboboxItem.svelte';

  let {
    value = $bindable<string | undefined>(undefined),
    portal,
    which = 'select',
    inSheet = true,
    onValueChange,
  }: {
    value?: string;
    /** Left unset on purpose: the default is what #674 is about. */
    portal?: HTMLElement | string | false;
    which?: 'select' | 'combobox';
    /** When false the same dropdown is rendered bare, with no modal above it. */
    inSheet?: boolean;
    onValueChange?: (value: string) => void;
  } = $props();

  const items = [
    { value: 'apple', label: 'Apple' },
    { value: 'banana', label: 'Banana' },
  ];
</script>

{#snippet dropdown()}
  {#if which === 'select'}
    <Select bind:value {portal} placeholder="Pick a fruit…" {onValueChange}>
      <SelectTrigger />
      <SelectContent>
        {#each items as item (item.value)}
          <SelectItem value={item.value} label={item.label} />
        {/each}
      </SelectContent>
    </Select>
  {:else}
    <Combobox bind:value {portal} {items} placeholder="Pick a fruit…" {onValueChange}>
      <ComboboxField>
        <ComboboxInput />
      </ComboboxField>
      <ComboboxContent>
        {#snippet children({ filteredItems })}
          {#each filteredItems as item, i (item.value)}
            <ComboboxItem {item} index={i} />
          {/each}
        {/snippet}
      </ComboboxContent>
    </Combobox>
  {/if}
{/snippet}

{#if inSheet}
  <Sheet open>
    <SheetContent class="sheet-under-test">
      <SheetTitle>Edit</SheetTitle>
      {@render dropdown()}
    </SheetContent>
  </Sheet>
{:else}
  {@render dropdown()}
{/if}
