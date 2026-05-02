<script lang="ts">
  import {
    Button,
    ListPage,
    SelectableList,
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
    Text,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { onMount } from 'svelte';
  import {
    canonItems,
    initCanonSync,
    syncPending,
    canonConflicts,
    resolveConflict,
    deleteCanonItem,
  } from '../../lib/canonService.js';
  import { aisles, initAisles } from '../../lib/aisleService.js';
  import { titleCase } from '../../lib/titleCase.js';

  onMount(() => {
    void initAisles();
    return initCanonSync();
  });

  let resolvingConflict = $state(false);
  let selected = $state(new Set<string>());

  const aisleMap = $derived(new Map($aisles.map((a) => [a.id, a.name])));

  async function handleBulkDelete(ids: string[]) {
    await Promise.all(ids.map((id) => deleteCanonItem(id)));
  }

  async function handleResolve(
    conflict: (typeof $canonConflicts)[number],
    strategy: 'keep-local' | 'keep-remote' | 'merge',
  ) {
    resolvingConflict = true;
    await resolveConflict(conflict, strategy);
    resolvingConflict = false;
  }
</script>

<ListPage
  title="Items"
  description="Your canonical item database."
  isLoading={$syncPending.initialSync || $syncPending.pull}
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

{#if $canonConflicts.length > 0}
  {@const conflict = $canonConflicts[0]!}
  <Dialog open={true}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Sync conflict: {titleCase(conflict.local.name)}</DialogTitle>
        <DialogDescription>
          This item was changed both locally and on another device. Choose which version to keep.
        </DialogDescription>
      </DialogHeader>
      <div class="grid grid-cols-2 gap-4 py-2 text-sm">
        <div>
          <Text muted>Local</Text>
          <p class="font-medium">{titleCase(conflict.local.name)}</p>
          {#if conflict.local.aisleId}
            <p class="text-muted-foreground">
              {titleCase(aisleMap.get(conflict.local.aisleId) ?? '')}
            </p>
          {/if}
        </div>
        <div>
          <Text muted>Remote</Text>
          <p class="font-medium">{titleCase(conflict.remote.name)}</p>
          {#if conflict.remote.aisleId}
            <p class="text-muted-foreground">
              {titleCase(aisleMap.get(conflict.remote.aisleId) ?? '')}
            </p>
          {/if}
        </div>
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          disabled={resolvingConflict}
          onclick={() => handleResolve(conflict, 'keep-local')}
        >
          Keep local
        </Button>
        <Button
          variant="outline"
          disabled={resolvingConflict}
          onclick={() => handleResolve(conflict, 'keep-remote')}
        >
          Keep remote
        </Button>
        <Button disabled={resolvingConflict} onclick={() => handleResolve(conflict, 'merge')}>
          Merge
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
{/if}
