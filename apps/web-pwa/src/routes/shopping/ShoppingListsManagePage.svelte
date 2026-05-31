<script lang="ts">
  import { Button, DetailPage, TextField } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    lists,
    defaultListId,
    addList,
    renameListById,
    removeList,
    changeDefaultList,
  } from '../../lib/shoppingListService.svelte.js';
  import { addToast } from '../../lib/toastStore.js';

  // ─── Add list ──────────────────────────────────────────────────────────────

  let newName = $state('');
  let addBusy = $state(false);

  async function handleAdd(): Promise<void> {
    const name = newName.trim();
    if (!name) return;
    addBusy = true;
    const result = await addList(name);
    addBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to create list.', 'error');
    } else {
      newName = '';
      push(`/shopping/${result.value.id}`);
    }
  }

  // ─── Rename ────────────────────────────────────────────────────────────────

  let editingListId = $state<string | null>(null);
  let editingName = $state('');
  let renameBusy = $state(false);

  function startEditing(id: string, currentName: string): void {
    editingListId = id;
    editingName = currentName;
  }

  function cancelEditing(): void {
    editingListId = null;
    editingName = '';
  }

  async function handleRename(listId: string): Promise<void> {
    const name = editingName.trim();
    const list = $lists.find((l) => l.id === listId);
    if (!name || name === list?.name) {
      cancelEditing();
      return;
    }
    renameBusy = true;
    const result = await renameListById(listId, name);
    renameBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to rename list.', 'error');
    } else {
      cancelEditing();
    }
  }

  // ─── Set default ──────────────────────────────────────────────────────────

  let defaultBusy = $state<string | null>(null);

  async function handleSetDefault(listId: string): Promise<void> {
    defaultBusy = listId;
    const result = await changeDefaultList(listId);
    defaultBusy = null;
    if (result.kind !== 'ok') {
      addToast('Failed to set default list.', 'error');
    }
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  let deleteBusy = $state<string | null>(null);

  async function handleDelete(listId: string): Promise<void> {
    deleteBusy = listId;
    const result = await removeList(listId);
    deleteBusy = null;
    if (result.kind !== 'ok') {
      addToast('Cannot delete the default list. Set another list as default first.', 'error');
    } else {
      addToast('List deleted.', 'success');
    }
  }
</script>

<DetailPage
  title="Shopping lists"
  onBack={() => push('/shopping')}
  backLabel="Back to shopping"
  class="p-4 sm:p-6"
>
  <div class="flex flex-col gap-6">
    <!-- Add list -->
    <section class="flex flex-col gap-2">
      <p class="text-sm font-medium">New list</p>
      <div class="flex gap-2">
        <TextField
          bind:value={newName}
          placeholder="List name…"
          disabled={addBusy}
          class="flex-1"
          data-testid="shopping-lists-name-input"
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleAdd();
            }
          }}
        />
        <Button
          onclick={handleAdd}
          loading={addBusy}
          disabled={!newName.trim() || addBusy}
          data-testid="shopping-lists-add-btn"
        >
          Add
        </Button>
      </div>
    </section>

    <!-- All lists -->
    <section class="flex flex-col gap-2">
      {#each $lists as list (list.id)}
        {@const isDefault = $defaultListId === list.id}
        {@const isEditing = editingListId === list.id}
        {@const rowBusy =
          deleteBusy === list.id || defaultBusy === list.id || (renameBusy && isEditing)}

        {#if isEditing}
          <div
            class="flex gap-2 rounded border border-border bg-card px-3 py-2"
            data-testid="shopping-list-row"
            data-list-id={list.id}
          >
            <TextField
              bind:value={editingName}
              class="flex-1"
              disabled={renameBusy}
              autofocus
              data-testid="shopping-list-rename-input"
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleRename(list.id);
                }
                if (e.key === 'Escape') cancelEditing();
              }}
            />
            <Button
              size="sm"
              onclick={() => handleRename(list.id)}
              loading={renameBusy}
              disabled={!editingName.trim() || renameBusy}
              data-testid="shopping-list-rename-save"
            >
              Save
            </Button>
            <Button variant="ghost" size="sm" onclick={cancelEditing} disabled={renameBusy}>
              Cancel
            </Button>
          </div>
        {:else}
          <div
            class="flex items-center gap-2 rounded border border-border bg-card px-3 py-2"
            data-testid="shopping-list-row"
            data-list-id={list.id}
          >
            <button
              type="button"
              class="flex-1 min-w-0 text-left flex items-center gap-2"
              onclick={() => push(`/shopping/${list.id}`)}
              data-testid="shopping-list-open-btn"
            >
              <span class="text-sm truncate">{list.name}</span>
              {#if isDefault}
                <span
                  class="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5 shrink-0"
                >
                  Default
                </span>
              {/if}
            </button>
            <div class="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onclick={() => startEditing(list.id, list.name)}
                disabled={rowBusy}
                data-testid="shopping-list-rename-btn"
              >
                Rename
              </Button>
              {#if !isDefault}
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => handleSetDefault(list.id)}
                  loading={defaultBusy === list.id}
                  disabled={rowBusy}
                  data-testid="shopping-list-set-default"
                >
                  Set default
                </Button>
              {/if}
              <Button
                variant="ghost"
                size="sm"
                onclick={() => handleDelete(list.id)}
                loading={deleteBusy === list.id}
                disabled={isDefault || rowBusy}
                class={isDefault
                  ? ''
                  : 'text-destructive hover:text-destructive hover:bg-destructive/10'}
                title={isDefault ? 'Set another list as default before deleting' : undefined}
                data-testid="shopping-list-delete-btn"
              >
                Delete
              </Button>
            </div>
          </div>
        {/if}
      {/each}
    </section>
  </div>
</DetailPage>
