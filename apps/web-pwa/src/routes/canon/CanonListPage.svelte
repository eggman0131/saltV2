<script lang="ts">
  import {
    Button,
    Checkbox,
    Icon,
    ListPage,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    Text,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    canonItems,
    isLoadingAisles,
    deleteCanonItem,
    approveCanonItems,
  } from '../../lib/canonService.js';
  import { aisles } from '../../lib/aisleService.js';
  import { titleCase } from '../../lib/titleCase.js';

  // Filter / display state
  let filterText = $state('');
  let approvalPlacement = $state<'top' | 'in-aisles'>('top');

  // Selection
  let selected = $state(new Set<string>());

  // Derived: filtered items
  const filteredItems = $derived(
    $canonItems.filter(
      (i) => filterText === '' || i.name.toLowerCase().includes(filterText.toLowerCase()),
    ),
  );

  // Derived: aisle lookup
  const aisleMap = $derived(new Map($aisles.map((a) => [a.id, a.name])));

  // Derived: items grouped by aisle, sorted alpha within each group.
  // Aisles appear in their stored order; unassigned at the end.
  type AisleGroup = { aisleId: string | null; aisleName: string; items: typeof filteredItems };

  const aisleGroups = $derived.by((): AisleGroup[] => {
    const itemsForMode =
      approvalPlacement === 'top' ? filteredItems.filter((i) => !i.needs_approval) : filteredItems;

    const byAisle = new Map<string | null, typeof filteredItems>([['__unassigned__', []]]);
    for (const aisle of $aisles) byAisle.set(aisle.id, []);

    for (const item of itemsForMode) {
      const key = item.aisleId ?? '__unassigned__';
      const bucket = byAisle.get(key);
      if (bucket) bucket.push(item);
      else byAisle.set(key, [item]);
    }

    const groups: AisleGroup[] = [];
    for (const aisle of $aisles) {
      const items = byAisle.get(aisle.id) ?? [];
      if (items.length > 0) {
        groups.push({
          aisleId: aisle.id,
          aisleName: titleCase(aisle.name),
          items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
        });
      }
    }
    const unassigned = byAisle.get('__unassigned__') ?? [];
    if (unassigned.length > 0) {
      groups.push({
        aisleId: null,
        aisleName: 'Unassigned',
        items: [...unassigned].sort((a, b) => a.name.localeCompare(b.name)),
      });
    }
    return groups;
  });

  // Derived: needs_approval items for the "at top" section
  const topApprovalItems = $derived(
    approvalPlacement === 'top'
      ? [...filteredItems.filter((i) => i.needs_approval)].sort((a, b) =>
          a.name.localeCompare(b.name),
        )
      : [],
  );

  // Derived: selection state
  const allVisibleIds = $derived(filteredItems.map((i) => i.id));
  const allSelected = $derived(
    allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id)),
  );
  const someSelected = $derived(allVisibleIds.some((id) => selected.has(id)) && !allSelected);
  const selectedCount = $derived(allVisibleIds.filter((id) => selected.has(id)).length);

  const selectedApprovalIds = $derived(
    [...selected].filter((id) => filteredItems.find((i) => i.id === id)?.needs_approval),
  );

  function toggleItem(id: string) {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    selected = s;
  }

  function toggleAll() {
    selected = allSelected ? new Set() : new Set(allVisibleIds);
  }

  function selectPending() {
    const s = new Set(selected);
    filteredItems.filter((i) => i.needs_approval).forEach((i) => s.add(i.id));
    selected = s;
  }

  async function handleBulkApprove() {
    await approveCanonItems(selectedApprovalIds);
    selected = new Set([...selected].filter((id) => !selectedApprovalIds.includes(id)));
  }

  async function handleBulkDelete() {
    await Promise.all([...selected].map((id) => deleteCanonItem(id)));
    selected = new Set();
  }
</script>

<ListPage
  title="Items"
  description="Your canonical item database."
  isLoading={$isLoadingAisles}
  isEmpty={$canonItems.length === 0}
  class="p-4 sm:p-6"
>
  {#snippet actions()}
    <Button variant="outline" onclick={() => push('/canon/aisles')}>Manage aisles</Button>
    <Button onclick={() => push('/canon/new')}>Add item</Button>
  {/snippet}

  {#snippet selectionBar()}
    <Checkbox
      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
      onCheckedChange={toggleAll}
      label={selectedCount > 0 ? `${selectedCount} selected` : 'Select all'}
    />
    {#if selectedCount > 0}
      <div class="flex items-center gap-2">
        {#if selectedApprovalIds.length > 0}
          <Button variant="outline" size="sm" onclick={handleBulkApprove}>
            Approve ({selectedApprovalIds.length})
          </Button>
        {/if}
        <Button variant="destructive" size="sm" onclick={handleBulkDelete}>Delete</Button>
        <Button variant="ghost" size="sm" onclick={() => (selected = new Set())}>Clear</Button>
      </div>
    {/if}
  {/snippet}

  {#snippet children()}
    <!-- Filter bar -->
    <div class="mb-4 flex flex-wrap items-end gap-2">
      <div class="flex-1">
        <input
          class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Filter items…"
          type="search"
          bind:value={filterText}
        />
      </div>
      <Select
        value={approvalPlacement}
        onValueChange={(v) => (approvalPlacement = v as typeof approvalPlacement)}
      >
        <SelectTrigger class="w-40">
          {approvalPlacement === 'top' ? 'Pending at top' : 'Pending in aisles'}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="top">Pending at top</SelectItem>
          <SelectItem value="in-aisles">Pending in aisles</SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- Pending-at-top section -->
    {#if topApprovalItems.length > 0}
      <div class="mb-4">
        <div class="mb-1 flex items-center justify-between">
          <h3
            class="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400"
          >
            Needs Review ({topApprovalItems.length})
          </h3>
          <button
            class="text-xs text-muted-foreground underline-offset-2 hover:underline"
            onclick={selectPending}
          >
            Select all pending
          </button>
        </div>
        <ul class="flex flex-col gap-1">
          {#each topApprovalItems as item (item.id)}
            {@const isSelected = selected.has(item.id)}
            <li
              class="flex items-center gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 dark:border-amber-700 dark:bg-amber-950/30 {isSelected
                ? 'ring-2 ring-ring border-ring'
                : ''}"
            >
              <Checkbox checked={isSelected} onCheckedChange={() => toggleItem(item.id)} />
              <button
                class="flex min-w-0 flex-1 items-center justify-between text-left"
                onclick={() => push(`/canon/${item.id}`)}
              >
                <Text>{titleCase(item.name)}</Text>
                {#if item.aisleId}
                  <Text muted size="sm">{titleCase(aisleMap.get(item.aisleId) ?? '')}</Text>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <!-- Grouped by aisle -->
    {#if aisleGroups.length > 0}
      <div class="flex flex-col gap-4">
        {#each aisleGroups as group (group.aisleId ?? '__unassigned__')}
          <div>
            <h3 class="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.aisleName}
            </h3>
            <ul class="flex flex-col gap-1">
              {#each group.items as item (item.id)}
                {@const isSelected = selected.has(item.id)}
                {@const isPending = item.needs_approval}
                <li
                  class="flex items-center gap-3 rounded-md border px-3 py-2
                    {isPending
                    ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30'
                    : 'border-border bg-card'}
                    {isSelected ? 'ring-2 ring-ring' + (isPending ? '' : ' border-ring') : ''}"
                >
                  <Checkbox checked={isSelected} onCheckedChange={() => toggleItem(item.id)} />
                  <button
                    class="flex min-w-0 flex-1 items-center justify-between text-left"
                    onclick={() => push(`/canon/${item.id}`)}
                  >
                    <Text>{titleCase(item.name)}</Text>
                    {#if isPending}
                      <span
                        class="ml-2 shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-800 dark:text-amber-200"
                      >
                        Review
                      </span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    {:else if filteredItems.length === 0 && filterText !== ''}
      <p class="py-4 text-center text-sm text-muted-foreground">No items match "{filterText}".</p>
    {/if}
  {/snippet}
</ListPage>
