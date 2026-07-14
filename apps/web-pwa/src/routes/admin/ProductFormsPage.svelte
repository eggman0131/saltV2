<script lang="ts">
  import { Button, ListPage } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import { productForms, isLoadingProductForms } from '../../lib/productFormService.js';
  import { canonItems } from '../../lib/canonService.js';
  import { titleCase } from '../../lib/titleCase.js';
  import AdminGuard from './AdminGuard.svelte';

  let filterText = $state('');

  const filtered = $derived(
    [...$productForms]
      .filter(
        (f) =>
          filterText === '' ||
          f.label.toLowerCase().includes(filterText.toLowerCase()) ||
          f.matchers.some((m) => m.toLowerCase().includes(filterText.toLowerCase())),
      )
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  function parentName(parentCanonId: string): string {
    const canon = $canonItems.find((c) => c.id === parentCanonId);
    return canon ? titleCase(canon.name) : 'Unknown item';
  }
</script>

<AdminGuard>
  <ListPage
    title="Product forms"
    description="Map an alternate form of an ingredient to a parent item and its yield."
    isLoading={$isLoadingProductForms}
    isEmpty={$productForms.length === 0}
    class="p-4 sm:p-6"
  >
    {#snippet actions()}
      <Button size="sm" onclick={() => push('/admin/product-forms/new')}>Add form</Button>
    {/snippet}

    {#snippet children()}
      <div class="mb-4">
        <input
          class="w-full rounded border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground"
          placeholder="Filter forms…"
          type="search"
          bind:value={filterText}
        />
      </div>

      {#if filtered.length > 0}
        <ul class="flex flex-col gap-1">
          {#each filtered as form (form.id)}
            <li>
              <button
                class="w-full rounded border border-border p-3 text-left transition-colors hover:bg-muted/50"
                data-testid="product-form-row"
                onclick={() => push(`/admin/product-forms/${form.id}`)}
              >
                <div class="font-medium text-foreground">{form.label}</div>
                <div class="text-sm text-muted-foreground">
                  {form.matchers.join(', ')} → {parentName(form.parentCanonId)} ·
                  {form.yield.amountPerParent}
                  {form.yield.formUnit} per item
                </div>
              </button>
            </li>
          {/each}
        </ul>
      {:else if filterText !== ''}
        <p class="py-4 text-center text-sm text-muted-foreground">
          No forms match "{filterText}".
        </p>
      {/if}
    {/snippet}
  </ListPage>
</AdminGuard>
