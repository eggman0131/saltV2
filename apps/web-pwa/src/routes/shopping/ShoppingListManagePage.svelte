<script lang="ts">
  import { Button, DetailPage, TextField, Text } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    lists,
    defaultListId,
    renameListById,
    removeList,
    changeDefaultList,
  } from '../../lib/shoppingListService.svelte.js';
  import { addToast } from '../../lib/toastStore.js';

  interface Props {
    params: { listId: string };
  }
  let { params }: Props = $props();

  const currentList = $derived($lists.find((l) => l.id === params.listId) ?? null);
  const isDefault = $derived($defaultListId === params.listId);

  // ─── Rename ───────────────────────────────────────────────────────────────────

  let nameValue = $state('');
  let renameBusy = $state(false);
  let _nameSet = false;

  $effect(() => {
    if (currentList && !_nameSet) {
      nameValue = currentList.name;
      _nameSet = true;
    }
  });

  async function handleRename(): Promise<void> {
    const name = nameValue.trim();
    if (!name || name === currentList?.name) return;
    renameBusy = true;
    const result = await renameListById(params.listId, name);
    renameBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to rename list.', 'error');
    } else {
      addToast('List renamed.', 'success');
    }
  }

  // ─── Set as default ───────────────────────────────────────────────────────────

  let defaultBusy = $state(false);

  async function handleSetDefault(): Promise<void> {
    defaultBusy = true;
    const result = await changeDefaultList(params.listId);
    defaultBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to set default list.', 'error');
    } else {
      addToast('Default list updated.', 'success');
    }
  }

  // ─── Delete ───────────────────────────────────────────────────────────────────

  let deleteBusy = $state(false);

  async function handleDelete(): Promise<void> {
    deleteBusy = true;
    const result = await removeList(params.listId);
    deleteBusy = false;
    if (result.kind !== 'ok') {
      addToast('Cannot delete the default list. Set another list as default first.', 'error');
    } else {
      addToast('List deleted.', 'success');
      push('/shopping');
    }
  }
</script>

{#if currentList === null}
  <div class="p-4 sm:p-6 flex flex-col gap-3">
    <p class="text-sm text-muted-foreground">List not found.</p>
    <Button variant="outline" onclick={() => push('/shopping')}>Go to shopping</Button>
  </div>
{:else}
  <DetailPage
    title={currentList.name}
    onBack={() => push(`/shopping/${params.listId}`)}
    backLabel="Back to list"
    class="p-4 sm:p-6"
  >
    <div class="flex flex-col gap-8">
      <!-- Rename -->
      <section class="flex flex-col gap-3">
        <p class="text-sm font-medium">List name</p>
        <div class="flex gap-2">
          <TextField
            bind:value={nameValue}
            placeholder="List name…"
            disabled={renameBusy}
            class="flex-1"
            data-testid="shopping-manage-name-input"
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleRename();
              }
            }}
          />
          <Button
            variant="outline"
            onclick={handleRename}
            loading={renameBusy}
            disabled={!nameValue.trim() || nameValue.trim() === currentList.name || renameBusy}
            data-testid="shopping-manage-rename-btn"
          >
            Rename
          </Button>
        </div>
      </section>

      <!-- Default list -->
      <section class="flex flex-col gap-3">
        <p class="text-sm font-medium">Default list</p>
        {#if isDefault}
          <Text class="text-sm text-muted-foreground">This is your default shopping list.</Text>
        {:else}
          <div class="flex items-center gap-3">
            <Text class="text-sm text-muted-foreground flex-1">
              Set as the list shown when you open shopping.
            </Text>
            <Button
              variant="outline"
              size="sm"
              onclick={handleSetDefault}
              loading={defaultBusy}
              disabled={defaultBusy}
              data-testid="shopping-manage-set-default"
            >
              Set as default
            </Button>
          </div>
        {/if}
      </section>

      <!-- Delete -->
      <section class="flex flex-col gap-3">
        <p class="text-sm font-medium">Danger zone</p>
        <div class="flex items-center gap-3">
          <Text class="text-sm text-muted-foreground flex-1">
            {#if isDefault}
              The default list cannot be deleted. Set another list as default first.
            {:else}
              Permanently delete this list and all its items.
            {/if}
          </Text>
          <Button
            variant="destructive"
            size="sm"
            onclick={handleDelete}
            loading={deleteBusy}
            disabled={isDefault || deleteBusy}
            data-testid="shopping-manage-delete"
          >
            Delete list
          </Button>
        </div>
      </section>
    </div>
  </DetailPage>
{/if}
