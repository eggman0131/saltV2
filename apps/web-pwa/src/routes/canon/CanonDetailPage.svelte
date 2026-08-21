<script lang="ts">
  import { push } from 'svelte-spa-router';
  import { goBack } from '../../lib/nav.js';
  import { Button, DetailPage, Icon, Text } from '@salt/ui-components';
  import {
    canonItems,
    updateCanonItemName,
    deleteCanonItem,
    splitMostRecentSynonym,
  } from '../../lib/canonService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { titleCase } from '../../lib/titleCase.js';
  import { createDeferredDelete } from '../../lib/deferredDelete.svelte.js';
  import { createSavedTick } from '../../lib/savedTick.svelte.js';
  import AdminGuard from '../admin/AdminGuard.svelte';
  import EditableRecordTitle from '../admin/EditableRecordTitle.svelte';
  import RecordEditor from '../admin/RecordEditor.svelte';

  let { params }: { params: Record<string, string> } = $props();

  let item = $derived($canonItems.find((c) => c.id === params.id));

  const saved = createSavedTick();

  // Deferred delete + Undo (issue #872) in place of a confirm dialog. Nothing is
  // deleted until the toast lapses, so "are you sure?" has nothing left to ask.
  // We navigate straight back to the list, where the row is still visible for the
  // undo window — honest, because it has not been deleted.
  const deferredDelete = createDeferredDelete();

  let nameError = $state('');

  async function saveName(next: string): Promise<void> {
    const current = item;
    if (!current) return;
    if (!next || next === current.name) return;
    nameError = '';
    const result = await updateCanonItemName(current, next);
    if (result.kind === 'ok') saved.flash();
    else nameError = 'Invalid name.';
  }

  let splitBusy = $state(false);

  async function handleSplit(): Promise<void> {
    const current = item;
    if (!current || current.synonyms.length === 0) return;
    splitBusy = true;
    const last = current.synonyms[current.synonyms.length - 1]!;
    const result = await splitMostRecentSynonym(current);
    splitBusy = false;
    if (result.kind === 'ok') {
      addToast(`Split "${titleCase(last)}" into a new item`, 'success');
      push(`/admin/canon/${result.value.id}`);
    }
  }

  function handleDelete(): void {
    const current = item;
    if (!current) return;
    const id = current.id;
    const name = titleCase(current.name);
    deferredDelete.request(
      [id],
      async () => {
        const result = await deleteCanonItem(id);
        if (result.kind !== 'ok') addToast('Failed to delete item.', 'destructive');
      },
      { message: `"${name}" deleted`, noun: 'item' },
    );
    push('/admin/canon');
  }
</script>

<AdminGuard>
  <div class="p-4 sm:p-6">
    {#if !item}
      <div class="flex flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" onclick={() => push('/admin/canon')}>
            {#snippet leading()}
              <Icon name="ArrowLeft" size={16} />
            {/snippet}
            Items
          </Button>
        </div>
        <Text muted>Item not found.</Text>
      </div>
    {:else}
      <DetailPage
        title={titleCase(item.name)}
        onBack={() => goBack('/admin/canon')}
        backLabel="Back"
      >
        {#snippet titleSlot()}
          <EditableRecordTitle
            value={item!.name}
            display={titleCase(item!.name)}
            testId="canon-detail-name-input"
            editLabel="Edit name"
            error={nameError}
            onCommit={saveName}
          />
        {/snippet}

        {#snippet actions()}
          {#if item!.synonyms.length > 0}
            <Button
              data-testid="canon-detail-split-button"
              variant="outline"
              size="sm"
              onclick={handleSplit}
              loading={splitBusy}
              disabled={splitBusy}
            >
              {#snippet leading()}
                <Icon name="Split" size={16} />
              {/snippet}
              Split
            </Button>
          {/if}
          <Button
            data-testid="canon-detail-delete-button"
            variant="destructive"
            size="sm"
            onclick={handleDelete}
          >
            {#snippet leading()}
              <Icon name="Trash2" size={16} />
            {/snippet}
            Delete
          </Button>
        {/snippet}

        <RecordEditor record={{ kind: 'canon', item }} {saved} />
      </DetailPage>
    {/if}
  </div>
</AdminGuard>
