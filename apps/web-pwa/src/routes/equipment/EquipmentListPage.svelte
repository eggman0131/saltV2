<script lang="ts">
  import {
    Button,
    Checkbox,
    ListPage,
    SelectableList,
    Spinner,
    type BulkAction,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    equipment,
    isLoadingEquipment,
    removeEquipmentItems,
  } from '../../lib/equipmentService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { createDeferredDelete } from '../../lib/deferredDelete.svelte.js';

  let selectionMode = $state(false);
  let selected = $state(new Set<string>());

  $effect(() => {
    if (!selectionMode) selected = new Set();
  });

  const deferredDelete = createDeferredDelete();

  const items = $derived($equipment?.items ?? []);
  const sorted = $derived([...items].sort((a, b) => a.name.localeCompare(b.name)));
  const visibleItems = $derived(deferredDelete.visible(sorted));

  const allIds = $derived(visibleItems.map((i) => i.id));
  const allSelected = $derived(allIds.length > 0 && allIds.every((id) => selected.has(id)));
  const someSelected = $derived(allIds.some((id) => selected.has(id)) && !allSelected);
  const selectedCount = $derived(allIds.filter((id) => selected.has(id)).length);

  function toggleAll() {
    selected = allSelected ? new Set() : new Set(allIds);
  }

  function handleBulkDelete(): void {
    if (selectedCount === 0) return;
    const ids = [...selected].filter((id) => allIds.includes(id));
    selectionMode = false; // the $effect on selectionMode clears `selected`
    deferredDelete.request(ids, async (delIds) => {
      const result = await removeEquipmentItems([...delIds]);
      if (result.kind !== 'ok') addToast('Failed to delete items.', 'destructive');
    });
  }

  const bulkActions = $derived<BulkAction[]>([
    {
      id: 'delete',
      label: 'Delete',
      icon: 'Trash2',
      variant: 'destructive',
      testId: 'equipment-bulk-delete',
      onSelect: handleBulkDelete,
    },
  ]);
</script>

<ListPage
  title="Kitchen"
  description="Your equipment manifest."
  isLoading={$isLoadingEquipment}
  isEmpty={visibleItems.length === 0}
  class="p-4 sm:p-6"
  bind:selectionMode
  selectionCount={selectedCount}
  {bulkActions}
>
  {#snippet actions()}
    <Button size="sm" onclick={() => push('/equipment/new')}>Add equipment</Button>
  {/snippet}

  {#snippet selectionBar()}
    <Checkbox
      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
      onCheckedChange={toggleAll}
      label={selectedCount > 0 ? `${selectedCount} selected` : 'Select all'}
    />
  {/snippet}

  {#snippet children()}
    <div data-testid="equipment-list">
      <SelectableList items={visibleItems} bind:selected {selectionMode}>
        {#snippet row(item)}
          <button
            class="w-full text-left text-sm font-medium hover:underline"
            onclick={() => push(`/equipment/${item.id}`)}
            data-testid="equipment-list-item"
            data-equipment-id={item.id}
          >
            {item.name}
            {#if item.accessories.length > 0}
              <span class="ml-2 text-xs text-muted-foreground">
                {item.accessories.length} accessor{item.accessories.length === 1 ? 'y' : 'ies'}
              </span>
            {/if}
            {#if item.rules.length > 0}
              <span class="ml-2 text-xs text-muted-foreground">
                {item.rules.length} rule{item.rules.length === 1 ? '' : 's'}
              </span>
            {/if}
          </button>
        {/snippet}
      </SelectableList>
    </div>
  {/snippet}
</ListPage>

{#if $isLoadingEquipment}
  <div class="flex items-center justify-center py-8">
    <Spinner size={24} />
  </div>
{/if}
