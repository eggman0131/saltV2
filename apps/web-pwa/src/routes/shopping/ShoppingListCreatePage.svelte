<script lang="ts">
  import { FormPage, TextField } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { addList } from '../../lib/shoppingListService.svelte.js';
  import { addToast } from '../../lib/toastStore.js';

  let listName = $state('');
  let busy = $state(false);

  async function handleSubmit(): Promise<void> {
    const name = listName.trim();
    if (!name) return;
    busy = true;
    const result = await addList(name);
    busy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to create list.', 'error');
      return;
    }
    addToast(`Created "${result.value.name}"`, 'success');
    push(`/shopping/${result.value.id}`);
  }

  const canSubmit = $derived(listName.trim().length > 0 && !busy);
</script>

<FormPage
  title="New list"
  description="Give your shopping list a name."
  submitLabel="Create"
  isSubmitting={busy}
  {canSubmit}
  onSubmit={handleSubmit}
  onCancel={() => push('/shopping')}
  class="p-4 sm:p-6"
>
  <div class="flex flex-col gap-1.5">
    <label class="text-sm font-medium" for="list-name">Name</label>
    <TextField
      id="list-name"
      bind:value={listName}
      placeholder="e.g. Weekly shop, Asian supermarket…"
      disabled={busy}
      autofocus
      data-testid="shopping-create-list-name"
    />
  </div>
</FormPage>
