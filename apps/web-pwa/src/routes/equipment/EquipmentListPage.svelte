<script lang="ts">
  import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    ListPage,
    Spinner,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    equipment,
    isLoadingEquipment,
    removeEquipmentItem,
  } from '../../lib/equipmentService.js';
  import { addToast } from '../../lib/toastStore.js';

  let deleteTargetId = $state<string | null>(null);
  let deleteBusy = $state(false);

  const items = $derived($equipment?.items ?? []);
  const sorted = $derived([...items].sort((a, b) => a.name.localeCompare(b.name)));

  async function handleDelete(): Promise<void> {
    if (!deleteTargetId) return;
    deleteBusy = true;
    const result = await removeEquipmentItem(deleteTargetId);
    deleteBusy = false;
    deleteTargetId = null;
    if (result.kind !== 'ok') {
      addToast('Failed to delete item.', 'error');
    }
  }
</script>

<ListPage
  title="Kitchen"
  description="Your equipment manifest."
  isLoading={$isLoadingEquipment}
  isEmpty={items.length === 0}
  class="p-4 sm:p-6"
>
  {#snippet actions()}
    <Button onclick={() => push('/equipment/new')}>Add equipment</Button>
  {/snippet}

  {#snippet children()}
    <ul class="flex flex-col gap-2" data-testid="equipment-list">
      {#each sorted as item (item.id)}
        <li
          class="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
        >
          <button
            class="flex-1 text-left text-sm font-medium hover:underline"
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
          <Button
            variant="ghost"
            size="sm"
            onclick={() => (deleteTargetId = item.id)}
            aria-label="Delete {item.name}"
          >
            Delete
          </Button>
        </li>
      {/each}
    </ul>
  {/snippet}
</ListPage>

<Dialog
  open={deleteTargetId !== null}
  onOpenChange={(v) => {
    if (!v) deleteTargetId = null;
  }}
>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="equipment-delete-dialog">
      <DialogHeader>
        <DialogTitle>Delete equipment?</DialogTitle>
        <DialogDescription>This cannot be undone.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onclick={() => (deleteTargetId = null)} disabled={deleteBusy}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          onclick={handleDelete}
          loading={deleteBusy}
          disabled={deleteBusy}
          data-testid="equipment-delete-confirm"
        >
          Delete
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>

{#if $isLoadingEquipment}
  <div class="flex items-center justify-center py-8">
    <Spinner size={24} />
  </div>
{/if}
