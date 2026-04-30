<script lang="ts">
  import {
    Button,
    ListPage,
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
  } from '../../lib/canonService.js';
  import { aisles, initAisles } from '../../lib/aisleService.js';

  onMount(() => {
    void initAisles();
    return initCanonSync();
  });

  let resolvingConflict = $state(false);

  async function handleResolve(
    conflict: (typeof $canonConflicts)[number],
    strategy: 'keep-local' | 'keep-remote' | 'merge',
  ) {
    resolvingConflict = true;
    await resolveConflict(conflict, strategy);
    resolvingConflict = false;
  }
</script>

<div class="p-4 sm:p-6">
  <ListPage
    title="Ingredients"
    description="Your canonical ingredient database."
    isLoading={$syncPending.initialSync || $syncPending.pull}
    isEmpty={$canonItems.length === 0}
  >
    {#snippet actions()}
      <Button variant="outline" onclick={() => push('/canon/aisles')}>Manage aisles</Button>
      <Button onclick={() => push('/canon/new')}>Add ingredient</Button>
    {/snippet}
    {#snippet children()}
      <ul class="divide-y divide-border rounded-lg border">
        {#each $canonItems as item (item.id)}
          <li>
            <button
              class="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/50"
              onclick={() => push(`/canon/${item.id}`)}
            >
              <span class="font-medium">{item.name}</span>
              {#if item.aisleId}
                <span class="text-sm text-muted-foreground">
                  {$aisles.find((a) => a.id === item.aisleId)?.name ?? ''}
                </span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/snippet}
  </ListPage>
</div>

{#if $canonConflicts.length > 0}
  {@const conflict = $canonConflicts[0]!}
  <Dialog open={true}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Sync conflict: {conflict.local.name}</DialogTitle>
        <DialogDescription>
          This ingredient was changed both locally and on another device. Choose which version to
          keep.
        </DialogDescription>
      </DialogHeader>
      <div class="grid grid-cols-2 gap-4 py-2 text-sm">
        <div>
          <Text muted>Local</Text>
          <p class="font-medium">{conflict.local.name}</p>
          {#if conflict.local.aisleId}
            <p class="text-muted-foreground">
              {$aisles.find((a) => a.id === conflict.local.aisleId)?.name ?? ''}
            </p>
          {/if}
        </div>
        <div>
          <Text muted>Remote</Text>
          <p class="font-medium">{conflict.remote.name}</p>
          {#if conflict.remote.aisleId}
            <p class="text-muted-foreground">
              {$aisles.find((a) => a.id === conflict.remote.aisleId)?.name ?? ''}
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
