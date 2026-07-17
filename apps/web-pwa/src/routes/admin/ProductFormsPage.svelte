<script lang="ts">
  import {
    Button,
    EditableRow,
    ListPage,
    SelectAllCheckbox,
    createListSelection,
    type BulkAction,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    productForms,
    isLoadingProductForms,
    deleteProductForm,
  } from '../../lib/productFormService.js';
  import { canonItems } from '../../lib/canonService.js';
  import { titleCase } from '../../lib/titleCase.js';
  import { addToast } from '../../lib/toastStore.js';
  import { createDeferredDelete } from '../../lib/deferredDelete.svelte.js';
  import AdminGuard from './AdminGuard.svelte';

  let filterText = $state('');

  // Selection mode — ListPage renders the Select/Done toggle itself once bound.
  let selectionMode = $state(false);

  // Deferred bulk delete (hide immediately, commit on undo-lapse — no confirm
  // dialog), matching CanonListPage.
  const deferredDelete = createDeferredDelete();

  const filtered = $derived(
    deferredDelete
      .visible($productForms)
      .filter(
        (f) =>
          filterText === '' ||
          f.label.toLowerCase().includes(filterText.toLowerCase()) ||
          f.matchers.some((m) => m.toLowerCase().includes(filterText.toLowerCase())),
      )
      .sort((a, b) => a.label.localeCompare(b.label)),
  );

  const allVisibleIds = $derived(filtered.map((f) => f.id));
  const selection = createListSelection({
    getAllIds: () => allVisibleIds,
    isSelectionMode: () => selectionMode,
  });

  function handleBulkDelete() {
    if (selection.count === 0) return;
    const ids = selection.ids;
    selectionMode = false; // exiting selection mode clears the selection
    deferredDelete.request(
      ids,
      async (delIds) => {
        const results = await Promise.all(delIds.map((id) => deleteProductForm(id)));
        if (results.some((r) => r.kind !== 'ok')) {
          addToast('Failed to delete some forms.', 'destructive');
        }
      },
      { noun: 'form' },
    );
  }

  const bulkActions = $derived<BulkAction[]>([
    {
      id: 'delete',
      label: 'Delete',
      icon: 'Trash2',
      variant: 'destructive',
      testId: 'product-forms-bulk-delete',
      onSelect: handleBulkDelete,
    },
  ]);

  // AI-seeded proposals (issue #500, Phase 3) surface in their own "Needs review"
  // section — these are already resolving recipes live; the section is the review
  // queue, not a gate. Confirmed/admin-created forms list below as normal.
  const pending = $derived(filtered.filter((f) => f.needs_approval));
  const confirmed = $derived(filtered.filter((f) => !f.needs_approval));

  function parentName(parentCanonId: string): string {
    const canon = $canonItems.find((c) => c.id === parentCanonId);
    return canon ? titleCase(canon.name) : 'Unknown item';
  }

  // Phase 2: the parent may itself be a freshly-minted, unconfirmed canon.
  // No stored back-reference — derive it from the subscribed canonItems.
  function parentNeedsApproval(parentCanonId: string): boolean {
    return $canonItems.find((c) => c.id === parentCanonId)?.needs_approval === true;
  }
</script>

<AdminGuard>
  <ListPage
    title="Product forms"
    description="Map an alternate form of an ingredient to a parent item and its yield."
    isLoading={$isLoadingProductForms}
    isEmpty={$productForms.length === 0}
    class="p-4 sm:p-6"
    bind:selectionMode
    selectionCount={selection.count}
    {bulkActions}
  >
    {#snippet actions()}
      <Button size="sm" onclick={() => push('/admin/product-forms/new')}>Add form</Button>
    {/snippet}

    {#snippet selectionBar()}
      <SelectAllCheckbox {selection} />
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

      <!-- Row body is identical at both breakpoints; EditableRow renders `narrow`
           only below sm: and `wide` only at sm:+, so both must be supplied or the
           row goes blank on mobile. -->
      {#snippet formBody(form: (typeof filtered)[number])}
        <button
          class="min-w-0 flex-1 rounded p-1 text-left transition-colors hover:bg-muted/50"
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
            {form.matchers.join(', ')} → {parentName(form.parentCanonId)}
            {#if form.needs_approval && parentNeedsApproval(form.parentCanonId)}
              <span
                class="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-800 dark:text-amber-200"
                data-testid="product-form-parent-new-badge"
              >
                new parent
              </span>
            {/if}
            · {form.yield.amountPerParent}
            {form.yield.formUnit} per item
          </div>
        </button>
      {/snippet}

      {#snippet formRow(form: (typeof filtered)[number])}
        <EditableRow
          selected={selection.isSelected(form.id)}
          shaded={form.needs_approval === true}
          onToggleSelect={selectionMode ? () => selection.toggle(form.id) : undefined}
        >
          {#snippet narrow()}
            {@render formBody(form)}
          {/snippet}
          {#snippet wide()}
            {@render formBody(form)}
          {/snippet}
        </EditableRow>
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
