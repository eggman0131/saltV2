<script lang="ts">
  import { Button, ListPage } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { onMount } from 'svelte';
  import { canonItems, initCanonSync } from '../../lib/canonService.js';

  let isLoading = $state(true);

  onMount(() => {
    const unsubscribeSync = initCanonSync();
    isLoading = false;
    return unsubscribeSync;
  });
</script>

<div class="p-4 sm:p-6">
  <ListPage
    title="Ingredients"
    description="Your canonical ingredient database."
    {isLoading}
    isEmpty={$canonItems.length === 0}
  >
    {#snippet actions()}
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
              {#if item.aisle}
                <span class="text-sm text-muted-foreground">{item.aisle}</span>
              {/if}
            </button>
          </li>
        {/each}
      </ul>
    {/snippet}
  </ListPage>
</div>
