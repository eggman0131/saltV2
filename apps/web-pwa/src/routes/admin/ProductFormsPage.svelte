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

  // AI-seeded proposals (issue #500, Phase 3) surface in their own "Needs review"
  // section — these are already resolving recipes live; the section is the review
  // queue, not a gate. Confirmed/admin-created forms list below as normal.
  const pending = $derived(filtered.filter((f) => f.needs_approval));
  const confirmed = $derived(filtered.filter((f) => !f.needs_approval));

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

      {#snippet formRow(form: (typeof filtered)[number])}
        <li>
          <button
            class="w-full rounded border p-3 text-left transition-colors {form.needs_approval
              ? 'border-amber-300 bg-amber-50 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950/30 dark:hover:bg-amber-950/50'
              : 'border-border hover:bg-muted/50'}"
            data-testid="product-form-row"
            onclick={() => push(`/admin/product-forms/${form.id}`)}
          >
            <div class="flex items-center gap-2">
              <span class="font-medium text-foreground">{form.label}</span>
              {#if form.needs_approval}
                <span
                  class="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-800 dark:text-amber-200"
                  data-testid="product-form-review-badge"
                >
                  Review
                </span>
              {/if}
            </div>
            <div class="text-sm text-muted-foreground">
              {form.matchers.join(', ')} → {parentName(form.parentCanonId)} ·
              {form.yield.amountPerParent}
              {form.yield.formUnit} per item
            </div>
          </button>
        </li>
      {/snippet}

      {#if filtered.length > 0}
        {#if pending.length > 0}
          <div class="mb-4" data-testid="product-forms-review-section">
            <h3
              class="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400"
            >
              Needs Review ({pending.length})
            </h3>
            <ul class="flex flex-col gap-1">
              {#each pending as form (form.id)}
                {@render formRow(form)}
              {/each}
            </ul>
          </div>
        {/if}
        {#if confirmed.length > 0}
          <ul class="flex flex-col gap-1">
            {#each confirmed as form (form.id)}
              {@render formRow(form)}
            {/each}
          </ul>
        {/if}
      {:else if filterText !== ''}
        <p class="py-4 text-center text-sm text-muted-foreground">
          No forms match "{filterText}".
        </p>
      {/if}
    {/snippet}
  </ListPage>
</AdminGuard>
