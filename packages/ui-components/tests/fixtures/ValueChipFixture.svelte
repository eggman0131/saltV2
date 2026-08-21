<!-- spec: ui-spec-v09.md §8.27 v0.9.1 — the three controls that wear the surface -->
<script lang="ts">
  import Select from '../../src/primitives/Select/Select.svelte';
  import SelectTrigger from '../../src/primitives/Select/SelectTrigger.svelte';
  import SelectContent from '../../src/primitives/Select/SelectContent.svelte';
  import SelectItem from '../../src/primitives/Select/SelectItem.svelte';
  import Combobox from '../../src/primitives/Combobox/Combobox.svelte';
  import ComboboxInput from '../../src/primitives/Combobox/ComboboxInput.svelte';
  import ComboboxContent from '../../src/primitives/Combobox/ComboboxContent.svelte';
  import ComboboxItem from '../../src/primitives/Combobox/ComboboxItem.svelte';
  import TextField from '../../src/primitives/TextField/TextField.svelte';
  import { valueChipVariants } from '../../src/primitives/Chip/Chip.variants';

  const AISLES = [
    { value: 'produce', label: 'Produce' },
    { value: 'dairy', label: 'Dairy' },
  ];

  let aisle = $state('produce');
  let amount = $state('500');
</script>

<div class="flex flex-wrap items-center gap-2">
  <!-- Combobox: the field and chevron trigger are dropped, so the pill is one
       control with one hit target (§8.27.4). -->
  <div class="w-40">
    <Combobox items={AISLES} bind:value={aisle} portal={false} restrict>
      <ComboboxInput
        class={valueChipVariants()}
        aria-label="Aisle"
        data-testid="value-chip-combobox"
      />
      <ComboboxContent>
        {#snippet children({ filteredItems })}
          {#each filteredItems as item, i (item.value)}
            <ComboboxItem {item} index={i} />
          {/each}
        {/snippet}
      </ComboboxContent>
    </Combobox>
  </div>

  <!-- Select: the trigger IS the button, so the surface goes straight on it. -->
  <div class="w-28">
    <Select value="stocked" portal={false}>
      <SelectTrigger
        class={valueChipVariants()}
        aria-label="How this is shopped"
        data-testid="value-chip-select"
      >
        Stocked
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="stocked" label="Stocked" />
        <SelectItem value="needed" label="Needed" />
      </SelectContent>
    </Select>
  </div>

  <!-- TextField: the surface must reach the FRAME, one level in (§8.27.5). -->
  <TextField
    class="w-20"
    frameClass={valueChipVariants()}
    inputmode="numeric"
    aria-label="Quantity threshold"
    bind:value={amount}
    data-testid="value-chip-input"
  />
</div>
