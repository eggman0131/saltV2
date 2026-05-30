<script lang="ts">
  import {
    Button,
    Checkbox,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    ListPage,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
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
  import CanonListRow from './CanonListRow.svelte';

  // Filter / display state
  let filterText = $state('');
  let approvalPlacement = $state<'top' | 'in-aisles'>('top');

  // Selection mode
  let selectionMode = $state(false);

  // Selection
  let selected = $state(new Set<string>());
  $effect(() => {
    if (!selectionMode) selected = new Set();
  });

  // Delete dialog
  let deleteOpen = $state(false);
  let deleteBusy = $state(false);

  // Derived: filtered items
  const filteredItems = $derived(
    $canonItems.filter(
      (i) => filterText === '' || i.name.toLowerCase().includes(filterText.toLowerCase()),
    ),
  );

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
    deleteBusy = true;
    await Promise.all([...selected].map((id) => deleteCanonItem(id)));
    deleteBusy = false;
    deleteOpen = false;
    selected = new Set();
  }
</script>

<ListPage
  title="Items"
  description="Your canonical item database."
  isLoading={$isLoadingAisles}
  isEmpty={$canonItems.length === 0}
  class="p-4 sm:p-6"
  bind:selectionMode
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
        <Button variant="destructive" size="sm" onclick={() => (deleteOpen = true)}>Delete</Button>
        <Button variant="ghost" size="sm" onclick={() => (selected = new Set())}>Clear</Button>
      </div>
    {/if}
  {/snippet}

  {#snippet children()}
    <!-- Filter bar -->
    <div class="mb-4 flex flex-wrap items-end gap-2">
      <div class="flex-1">
        <input
          class="w-full rounded border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground"
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
          {#if selectionMode}
            <button
              class="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onclick={selectPending}
            >
              Select all pending
            </button>
          {/if}
        </div>
        <ul class="flex flex-col gap-1">
          {#each topApprovalItems as item (item.id)}
            <CanonListRow
              {item}
              aisles={$aisles}
              selected={selected.has(item.id)}
              onToggleSelect={selectionMode ? () => toggleItem(item.id) : undefined}
            />
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
                <CanonListRow
                  {item}
                  aisles={$aisles}
                  selected={selected.has(item.id)}
                  onToggleSelect={selectionMode ? () => toggleItem(item.id) : undefined}
                />
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

<!-- Bulk delete confirmation dialog -->
<Dialog
  bind:open={deleteOpen}
  onOpenChange={(v) => {
    if (!v) deleteBusy = false;
  }}
>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="canon-list-bulk-delete-dialog">
      <DialogHeader>
        <DialogTitle>Delete {selected.size} {selected.size === 1 ? 'item' : 'items'}?</DialogTitle>
        <DialogDescription>This action cannot be undone.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onclick={() => (deleteOpen = false)} disabled={deleteBusy}>
          Cancel
        </Button>
        <Button
          data-testid="canon-list-bulk-delete-confirm"
          variant="destructive"
          onclick={handleBulkDelete}
          loading={deleteBusy}
          disabled={deleteBusy}
        >
          Delete
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
