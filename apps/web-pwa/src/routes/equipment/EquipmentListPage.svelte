<script lang="ts">
  import {
    Button,
    ListPage,
    SelectableList,
    SelectAllCheckbox,
    Spinner,
    createListSelection,
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

  const deferredDelete = createDeferredDelete();

  const items = $derived($equipment?.items ?? []);
  const sorted = $derived([...items].sort((a, b) => a.name.localeCompare(b.name)));
  const visibleItems = $derived(deferredDelete.visible(sorted));

  const allIds = $derived(visibleItems.map((i) => i.id));
  const selection = createListSelection({
    getAllIds: () => allIds,
    isSelectionMode: () => selectionMode,
  });

  function handleBulkDelete(): void {
    if (selection.count === 0) return;
    const ids = selection.ids;
    selectionMode = false; // exiting selection mode clears the selection
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
  selectionCount={selection.count}
  {bulkActions}
>
  {#snippet actions()}
    <Button size="sm" onclick={() => push('/equipment/new')}>Add equipment</Button>
  {/snippet}

  {#snippet selectionBar()}
    <SelectAllCheckbox {selection} />
  {/snippet}

  {#snippet children()}
    <div data-testid="equipment-list">
      <SelectableList items={visibleItems} {selection}>
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
