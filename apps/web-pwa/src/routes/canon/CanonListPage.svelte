<script lang="ts">
  import { Button, Checkbox, ListPage, SelectableList, Text } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { canonItems, isLoadingAisles, deleteCanonItem } from '../../lib/canonService.js';
  import { aisles } from '../../lib/aisleService.js';
  import { titleCase } from '../../lib/titleCase.js';

  let selected = $state(new Set<string>());

  const aisleMap = $derived(new Map($aisles.map((a) => [a.id, a.name])));
  const allSelected = $derived(
    $canonItems.length > 0 && $canonItems.every((i) => selected.has(i.id)),
  );
  const someSelected = $derived($canonItems.some((i) => selected.has(i.id)) && !allSelected);

  function toggleAll() {
    selected = allSelected ? new Set() : new Set($canonItems.map((i) => i.id));
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
      label={selected.size > 0 ? `${selected.size} selected` : 'Select all'}
    />
    {#if selected.size > 0}
      <div class="flex items-center gap-2">
        <Button variant="destructive" size="sm" onclick={handleBulkDelete}>Delete</Button>
        <Button variant="ghost" size="sm" onclick={() => (selected = new Set())}>Clear</Button>
      </div>
    {/if}
  {/snippet}
  {#snippet children()}
    <SelectableList items={[...$canonItems]} bind:selected>
      {#snippet row(item)}
        <button
          class="flex w-full items-center justify-between text-left"
          onclick={() => push(`/canon/${item.id}`)}
        >
          <Text>{titleCase(item.name)}</Text>
          {#if item.aisleId}
            <Text muted size="sm">{titleCase(aisleMap.get(item.aisleId) ?? '')}</Text>
          {/if}
        </button>
      {/snippet}
    </SelectableList>
  {/snippet}
</ListPage>
