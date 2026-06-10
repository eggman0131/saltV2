<script lang="ts">
  import {
    Button,
    ListPage,
    Select,
    SelectAllCheckbox,
    SelectContent,
    SelectItem,
    SelectTrigger,
    createListSelection,
    type BulkAction,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    canonItems,
    isLoadingAisles,
    deleteCanonItem,
    approveCanonItems,
    regenerateCanonIcon,
  } from '../../lib/canonService.js';
  import { aisles } from '../../lib/aisleService.js';
  import { titleCase } from '../../lib/titleCase.js';
  import { addToast } from '../../lib/toastStore.js';
  import { createDeferredDelete } from '../../lib/deferredDelete.svelte.js';
  import CanonListRow from './CanonListRow.svelte';
  import AdminGuard from '../admin/AdminGuard.svelte';

  // Filter / display state
  let filterText = $state('');
  let approvalPlacement = $state<'top' | 'in-aisles'>('top');

  // Selection mode
  let selectionMode = $state(false);

  // Deferred bulk delete (hide immediately, commit on undo-lapse — no confirm dialog).
  const deferredDelete = createDeferredDelete();

  // Derived: filtered items (pending-delete items are hidden while the undo toast is up)
  const filteredItems = $derived(
    deferredDelete.visible(
      $canonItems.filter(
        (i) => filterText === '' || i.name.toLowerCase().includes(filterText.toLowerCase()),
      ),
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
  const selection = createListSelection({
    getAllIds: () => allVisibleIds,
    isSelectionMode: () => selectionMode,
  });

  const selectedApprovalIds = $derived(
    [...selection.selected].filter((id) => filteredItems.find((i) => i.id === id)?.needs_approval),
  );

  function selectPending() {
    selection.add(filteredItems.filter((i) => i.needs_approval).map((i) => i.id));
  }

  async function handleBulkApprove() {
    await approveCanonItems(selectedApprovalIds);
    selection.remove(selectedApprovalIds);
  }

  async function handleBulkRegenerateIcon() {
    if (selection.count === 0) return;
    const ids = selection.ids;
    selectionMode = false; // exiting selection mode clears the selection
    const results = await Promise.all(ids.map((id) => regenerateCanonIcon(id)));
    if (results.some((r) => r.kind !== 'ok')) {
      addToast('Failed to regenerate some icons.', 'destructive');
    } else {
      addToast(`Regenerating ${ids.length} icon${ids.length === 1 ? '' : 's'}…`, 'success');
    }
  }

  function handleBulkDelete() {
    if (selection.count === 0) return;
    const ids = selection.ids;
    selectionMode = false; // exiting selection mode clears the selection
    deferredDelete.request(ids, async (delIds) => {
      const results = await Promise.all(delIds.map((id) => deleteCanonItem(id)));
      if (results.some((r) => r.kind !== 'ok')) {
        addToast('Failed to delete some items.', 'destructive');
      }
    });
  }

  // Contextual bottom action bar. Approve only appears when pending items are
  // selected; Delete is always available and uses deferred-delete + undo.
  const bulkActions = $derived<BulkAction[]>([
    ...(selectedApprovalIds.length > 0
      ? [
          {
            id: 'approve',
            label: `Approve (${selectedApprovalIds.length})`,
            icon: 'Check',
            testId: 'canon-bulk-approve',
            onSelect: () => void handleBulkApprove(),
          } satisfies BulkAction,
        ]
      : []),
    {
      id: 'regenerate-icon',
      label: 'Regenerate icon',
      icon: 'RefreshCw',
      testId: 'canon-list-bulk-regenerate-icon',
      onSelect: () => void handleBulkRegenerateIcon(),
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: 'Trash2',
      variant: 'destructive',
      testId: 'canon-list-bulk-delete',
      onSelect: handleBulkDelete,
    },
  ]);
</script>

<AdminGuard>
  <ListPage
    title="Items"
    description="Your canonical item database."
    isLoading={$isLoadingAisles}
    isEmpty={$canonItems.length === 0}
    class="p-4 sm:p-6"
    bind:selectionMode
    selectionCount={selection.count}
    {bulkActions}
  >
    {#snippet actions()}
      <Button size="sm" onclick={() => push('/admin/canon/new')}>Add item</Button>
    {/snippet}

    {#snippet selectionBar()}
      <SelectAllCheckbox {selection} />
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
                selected={selection.isSelected(item.id)}
                onToggleSelect={selectionMode ? () => selection.toggle(item.id) : undefined}
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
                    selected={selection.isSelected(item.id)}
                    onToggleSelect={selectionMode ? () => selection.toggle(item.id) : undefined}
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
</AdminGuard>
