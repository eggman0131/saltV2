<script lang="ts">
  import { push, router } from 'svelte-spa-router';
  import { goBack } from '../../lib/nav.js';
  import {
    Button,
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxField,
    ComboboxInput,
    ComboboxItem,
    ComboboxTrigger,
    DetailPage,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    TextField,
  } from '@salt/ui-components';
  import type { CanonItemUnit } from '@salt/shared-types';
  import { addProductForm } from '../../lib/productFormService.js';
  import { canonItems } from '../../lib/canonService.js';
  import { titleCase } from '../../lib/titleCase.js';
  import { addToast } from '../../lib/toastStore.js';
  import AdminGuard from './AdminGuard.svelte';

  /**
   * Creating a product form — and only creating it (issues #500, #872).
   *
   * Editing one moved into the catalog, where a form is a row under its parent
   * item and the record editor is the pane beside it. Creating stays here and
   * stays staged behind an explicit "Add form": there is no record to autosave
   * into, and creating is a consequence. Its fields are its own — `RecordEditor`
   * edits a record that exists.
   */

  // `?parent=<canonId>` seeds the parent when a canon item sent you here, read off
  // the live router like `readMealParam(router.querystring)` does (#752).
  const seededParentId = $derived(
    router.querystring ? (new URLSearchParams(router.querystring).get('parent') ?? '') : '',
  );

  let newLabel = $state('');
  let newMatchers = $state('');
  let newParentId = $state('');
  let newAmount = $state('');
  let newUnit = $state<CanonItemUnit>('ml');
  let newParentSeeded = $state(false);
  let createBusy = $state(false);
  let createError = $state('');

  $effect(() => {
    if (newParentSeeded) return;
    newParentSeeded = true;
    newParentId = seededParentId;
  });

  const canonComboItems = $derived(
    $canonItems.map((c) => ({ value: c.id, label: titleCase(c.name) })),
  );

  async function handleCreate(): Promise<void> {
    createError = '';
    createBusy = true;
    const result = await addProductForm({
      matchers: newMatchers
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
      parentCanonId: newParentId,
      label: newLabel,
      formUnit: newUnit,
      amountPerParent: parseFloat(newAmount),
    });
    createBusy = false;
    if (result.kind !== 'ok') {
      createError =
        'Please give a label, pick a parent item, add at least one matcher, and a yield amount above 0.';
      return;
    }
    addToast('Added product form', 'success');
    push(`/admin/catalog/f:${result.value.id}`);
  }
</script>

<AdminGuard>
  <div class="p-4 sm:p-6">
    <DetailPage title="Add product form" onBack={() => goBack('/admin/catalog')} backLabel="Back">
      <div class="flex max-w-xl flex-col gap-4">
        <TextField
          label="Label"
          description="How this form reads, e.g. “lime juice”. Recipes are matched against it, so you don’t need to repeat it below."
          value={newLabel}
          onValueChange={(v) => (newLabel = v)}
          placeholder="e.g. freshly squeezed lime juice"
          data-testid="product-form-label-input"
        />

        <TextField
          label="Matchers"
          description="Comma-separated EXTRA phrasings a recipe might use, e.g. “dark meat, drumsticks”. Plurals and quantities are ignored when matching."
          value={newMatchers}
          onValueChange={(v) => (newMatchers = v)}
          placeholder="e.g. lime juice, fresh lime juice"
          data-testid="product-form-matchers-input"
        />

        <div class="flex flex-col gap-1.5">
          <span class="text-sm font-medium text-foreground">Parent item</span>
          <div data-testid="product-form-parent-select">
            <Combobox
              items={canonComboItems}
              value={newParentId}
              onValueChange={(v) => (newParentId = v)}
              placeholder="Search items…"
              restrict
            >
              <ComboboxField>
                <ComboboxInput />
                <ComboboxTrigger />
              </ComboboxField>
              <ComboboxContent>
                {#snippet children({ filteredItems })}
                  {#each filteredItems as cbItem, i (cbItem.value)}
                    <ComboboxItem item={cbItem} index={i} />
                  {/each}
                  {#if filteredItems.length === 0}
                    <ComboboxEmpty>No items match.</ComboboxEmpty>
                  {/if}
                {/snippet}
              </ComboboxContent>
            </Combobox>
          </div>
        </div>

        <div class="flex items-end gap-2">
          <div class="flex-1">
            <TextField
              label="Yield per parent"
              inputmode="decimal"
              value={newAmount}
              onValueChange={(v) => (newAmount = v)}
              placeholder="e.g. 30"
              data-testid="product-form-amount-input"
            />
          </div>
          <div class="w-28">
            <Select value={newUnit} onValueChange={(v) => (newUnit = v as CanonItemUnit)}>
              <SelectTrigger data-testid="product-form-unit-select">{newUnit}</SelectTrigger>
              <SelectContent>
                <SelectItem value="g">g</SelectItem>
                <SelectItem value="ml">ml</SelectItem>
                <SelectItem value="count">count</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {#if createError}
          <p class="text-sm text-destructive">{createError}</p>
        {/if}

        <div class="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onclick={() => goBack('/admin/catalog')} disabled={createBusy}>
            Cancel
          </Button>
          <Button
            data-testid="product-form-save-button"
            onclick={handleCreate}
            loading={createBusy}
            disabled={createBusy}
          >
            Add form
          </Button>
        </div>
      </div>
    </DetailPage>
  </div>
</AdminGuard>
