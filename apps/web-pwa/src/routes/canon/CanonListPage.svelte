<script lang="ts">
  import { Button, ListPage, SelectableList, Text } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { canonItems, isLoadingAisles, deleteCanonItem } from '../../lib/canonService.js';
  import { aisles } from '../../lib/aisleService.js';
  import { titleCase } from '../../lib/titleCase.js';

  let selected = $state(new Set<string>());

  const aisleMap = $derived(new Map($aisles.map((a) => [a.id, a.name])));

  async function handleBulkDelete(ids: string[]) {
    await Promise.all(ids.map((id) => deleteCanonItem(id)));
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
  {#snippet children()}
    <SelectableList
      items={[...$canonItems]}
      bind:selected
      bulkActions={[
        { id: 'delete', label: 'Delete', variant: 'destructive', onAction: handleBulkDelete },
      ]}
    >
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
