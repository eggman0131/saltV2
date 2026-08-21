<script lang="ts">
  // Rule 7: primitives are consumed ONLY through @salt/ui-components.
  import {
    Chip,
    ChipGroup,
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    TextField,
    valueChipVariants,
  } from '@salt/ui-components';

  let { withFilters = true }: { withFilters?: boolean } = $props();

  const AISLES = [
    { value: '', label: 'No aisle' },
    { value: 'produce', label: 'Produce' },
    { value: 'dairy', label: 'Dairy' },
    { value: 'baking', label: 'Baking' },
  ];

  const BEHAVIOURS: Record<string, string> = {
    stocked: 'Stocked',
    check: 'Check',
    needed: 'Needed',
  };

  let aisle = $state('produce');
  let behaviour = $state('stocked');
  let amount = $state('500');
  let unit = $state('g');
</script>

<!-- The catalog's review row (ui-spec-v09 §8.27.1): what the pipeline decided,
     as three pills a reviewer can correct without leaving the list. The surface
     is worn BY each control — the combobox input, the select trigger, the text
     field's frame — so every one keeps its own popover, focus and ARIA. -->
<div class="flex max-w-lg flex-col gap-3">
  {#if withFilters}
    <!-- For contrast: a row of real Chips. Same pill, opposite job — these hold
         an on/off state and carry aria-pressed; the ones below hold a value and
         never do (§8.23.2, §8.27.6). -->
    <ChipGroup ariaLabel="Filters">
      <Chip pressed>Needs review</Chip>
      <Chip>Has forms</Chip>
      <Chip variant="expander">+2 more</Chip>
    </ChipGroup>
  {/if}

  <div
    class="flex flex-col gap-2 rounded border border-border bg-card p-3 text-sm text-muted-foreground"
  >
    <p>Created from “2 lemons”</p>

    <div class="flex flex-wrap items-center gap-2">
      <!-- The surface sets no width; the caller sizes the wrapper (§8.27.4). -->
      <div class="w-40">
        <Combobox items={AISLES} bind:value={aisle} placeholder="No aisle" restrict>
          <ComboboxInput class={valueChipVariants()} aria-label="Aisle" />
          <ComboboxContent>
            {#snippet children({ filteredItems })}
              {#each filteredItems as item, i (item.value)}
                <ComboboxItem {item} index={i} />
              {/each}
              {#if filteredItems.length === 0}
                <ComboboxEmpty>No aisles match.</ComboboxEmpty>
              {/if}
            {/snippet}
          </ComboboxContent>
        </Combobox>
      </div>

      <div class="w-28">
        <Select bind:value={behaviour}>
          <SelectTrigger class={valueChipVariants()} aria-label="How this is shopped">
            {BEHAVIOURS[behaviour]}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stocked" label="Stocked" />
            <SelectItem value="check" label="Check" />
            <SelectItem value="needed" label="Needed" />
          </SelectContent>
        </Select>
      </div>

      <!-- The third decision is typed, not picked — the reason the value chip is
           a class and not a component (§8.27.5). -->
      <TextField
        class="w-20"
        frameClass={valueChipVariants()}
        inputmode="numeric"
        aria-label="Quantity threshold"
        placeholder="None"
        bind:value={amount}
      />
      <div class="w-24">
        <Select bind:value={unit}>
          <SelectTrigger class={valueChipVariants()} aria-label="Threshold unit">
            {unit}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="g" label="g" />
            <SelectItem value="ml" label="ml" />
            <SelectItem value="count" label="count" />
          </SelectContent>
        </Select>
      </div>
    </div>
  </div>
</div>
