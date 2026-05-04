<script lang="ts">
  import {
    EditableRow,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    Text,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import type { Aisle, CanonItem, CanonItemUnit, ShoppingBehavior } from '@salt/domain';
  import {
    updateCanonItemAisle,
    updateCanonItemShoppingBehavior,
    updateCanonItemThreshold,
  } from '../../lib/canonService.js';
  import { titleCase } from '../../lib/titleCase.js';

  let {
    item,
    aisles,
    selected,
    onToggleSelect,
  }: {
    item: CanonItem;
    aisles: readonly Aisle[];
    selected: boolean;
    onToggleSelect: () => void;
  } = $props();

  let thresholdStr = $state(
    item.largeQuantityThreshold != null ? String(item.largeQuantityThreshold) : '',
  );
  let unitVal = $state<CanonItemUnit>(item.unit ?? 'g');

  $effect(() => {
    thresholdStr = item.largeQuantityThreshold != null ? String(item.largeQuantityThreshold) : '';
    unitVal = item.unit ?? 'g';
  });

  async function handleAisleChange(value: string) {
    await updateCanonItemAisle(item, value || null);
  }

  async function handleBehaviorChange(value: string) {
    await updateCanonItemShoppingBehavior(item, value as ShoppingBehavior);
  }

  async function saveThreshold() {
    const raw = thresholdStr.trim();
    const parsed = raw ? parseFloat(raw) : undefined;
    const validParsed = parsed !== undefined && !isNaN(parsed) ? parsed : undefined;
    const unit = validParsed !== undefined ? unitVal : undefined;
    await updateCanonItemThreshold(item, validParsed, unit);
  }

  async function handleUnitChange(value: string) {
    unitVal = value as CanonItemUnit;
    // Only persist when threshold has a value — unit alone is meaningless without threshold
    if (thresholdStr.trim()) {
      await saveThreshold();
    }
  }

  const behaviorLabel: Record<ShoppingBehavior, string> = {
    stocked: 'Stocked',
    check: 'Check',
    needed: 'Needed',
  };
</script>

<EditableRow {selected} shaded={item.needs_approval} {onToggleSelect}>
  {#snippet narrow()}
    <button
      class="flex min-w-0 flex-1 items-center justify-between text-left"
      onclick={() => push(`/canon/${item.id}`)}
    >
      <Text>{titleCase(item.name)}</Text>
      {#if item.needs_approval}
        <span
          class="ml-2 shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-800 dark:text-amber-200"
        >
          Review
        </span>
      {:else if item.aisleId}
        <Text muted size="sm"
          >{titleCase(aisles.find((a) => a.id === item.aisleId)?.name ?? '')}</Text
        >
      {/if}
    </button>
  {/snippet}

  {#snippet wide()}
    <button
      class="min-w-[120px] flex-1 truncate text-left text-sm font-medium"
      onclick={() => push(`/canon/${item.id}`)}
      data-testid="canon-list-row-name"
    >
      {titleCase(item.name)}
    </button>
    {#if item.needs_approval}
      <span
        class="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-800 dark:text-amber-200"
      >
        Review
      </span>
    {/if}

    <Select value={item.aisleId ?? ''} onValueChange={handleAisleChange}>
      <SelectTrigger class="h-7 w-32 shrink-0 text-xs">
        {item.aisleId
          ? titleCase(aisles.find((a) => a.id === item.aisleId)?.name ?? '')
          : 'No aisle'}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">No aisle</SelectItem>
        {#each aisles as aisle (aisle.id)}
          <SelectItem value={aisle.id}>{titleCase(aisle.name)}</SelectItem>
        {/each}
      </SelectContent>
    </Select>

    <Select value={item.shoppingBehavior} onValueChange={handleBehaviorChange}>
      <SelectTrigger class="h-7 w-24 shrink-0 text-xs">
        {behaviorLabel[item.shoppingBehavior]}
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="stocked">Stocked</SelectItem>
        <SelectItem value="check">Check</SelectItem>
        <SelectItem value="needed">Needed</SelectItem>
      </SelectContent>
    </Select>

    <div class="flex shrink-0 items-center gap-1">
      <input
        type="number"
        class="h-7 w-16 rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        placeholder="Qty"
        min="0"
        step="1"
        bind:value={thresholdStr}
        onblur={saveThreshold}
        data-testid="canon-list-row-threshold"
      />
      <Select value={unitVal} onValueChange={handleUnitChange}>
        <SelectTrigger class="h-7 w-20 shrink-0 text-xs">
          {unitVal}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="g">g</SelectItem>
          <SelectItem value="ml">ml</SelectItem>
          <SelectItem value="count">count</SelectItem>
        </SelectContent>
      </Select>
    </div>
  {/snippet}
</EditableRow>
