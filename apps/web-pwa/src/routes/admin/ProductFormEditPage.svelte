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
    Icon,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    TextField,
  } from '@salt/ui-components';
  import type { CanonItemUnit } from '@salt/shared-types';
  import {
    productForms,
    addProductForm,
    editProductForm,
    deleteProductForm,
  } from '../../lib/productFormService.js';
  import { canonItems } from '../../lib/canonService.js';
  import { titleCase } from '../../lib/titleCase.js';
  import { addToast } from '../../lib/toastStore.js';
  import { createDeferredDelete } from '../../lib/deferredDelete.svelte.js';
  import { createSavedTick } from '../../lib/savedTick.svelte.js';
  import AdminGuard from './AdminGuard.svelte';
  import EditableRecordTitle from './EditableRecordTitle.svelte';
  import RecordEditor from './RecordEditor.svelte';

  // `params` is OPTIONAL: this page serves both `/admin/product-forms/new` (static,
  // no route params) and `/admin/product-forms/:id`. svelte-spa-router only passes a
  // `params` prop for parameterised routes, so on the /new route it is undefined —
  // typing it as required made `params.id` throw on mount and hang the add page on
  // its route-loading spinner. RecipeEditPage serves /recipes/new the same way.
  let { params }: { params?: { id?: string } } = $props();

  const existing = $derived(
    params?.id ? ($productForms.find((f) => f.id === params?.id) ?? null) : null,
  );
  const isEdit = $derived(!!params?.id);

  const saved = createSavedTick();
  const deferredDelete = createDeferredDelete();

  // ─── Edit path ──────────────────────────────────────────────────────────────
  // Everything below the title is `RecordEditor`, which autosaves. Only the label
  // lives here, because it is the page's identity and belongs in the heading.

  let labelError = $state('');

  async function saveLabel(next: string): Promise<void> {
    const f = existing;
    if (!f) return;
    if (!next || next === f.label) return;
    labelError = '';
    const result = await editProductForm(f, {
      matchers: f.matchers,
      parentCanonId: f.parentCanonId,
      label: next,
      formUnit: f.yield.formUnit,
      amountPerParent: f.yield.amountPerParent,
    });
    if (result.kind === 'ok') saved.flash();
    else labelError = 'Invalid label.';
  }

  // ─── Create path ────────────────────────────────────────────────────────────
  // Deliberately still staged behind an explicit "Add form": there is no record
  // to autosave into, and creating is a consequence. Its fields are its own —
  // `RecordEditor` edits a record that exists.
  //
  // `?parent=<canonId>` seeds the parent when a canon item sent you here, read
  // off the live router like `readMealParam(router.querystring)` does (#752).
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
    if (isEdit || newParentSeeded) return;
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
    push('/admin/product-forms');
  }

  // ─── Delete ─────────────────────────────────────────────────────────────────
  // Deferred + Undo, no confirm dialog (issue #872). The id and label are read
  // BEFORE the deferral: `existing` derives off the live subscription and is gone
  // the moment the delete lands.

  function handleDelete(): void {
    const target = existing;
    if (!target) return;
    const id = target.id;
    const label = target.label;
    deferredDelete.request(
      [id],
      async () => {
        const result = await deleteProductForm(id);
        if (result.kind !== 'ok') addToast('Failed to delete form.', 'destructive');
      },
      { message: `"${label}" deleted`, noun: 'form' },
    );
    push('/admin/product-forms');
  }
</script>

<AdminGuard>
  <div class="p-4 sm:p-6">
    {#if isEdit && !existing}
      <div class="flex flex-col gap-4">
        <Button variant="ghost" size="sm" onclick={() => push('/admin/product-forms')}>
          {#snippet leading()}
            <Icon name="ArrowLeft" size={16} />
          {/snippet}
          Product forms
        </Button>
        <p class="text-sm text-muted-foreground">Form not found.</p>
      </div>
    {:else if existing}
      <!-- The label's guidance rides as the subtitle: the field itself moved into
           the heading, and the point it makes — that recipes are matched against
           the label, so the matchers below are EXTRA phrasings — is the one thing
           a reviewer needs before touching either. -->
      <DetailPage
        title={existing.label}
        subtitle="How this form reads, e.g. “lime juice”. Recipes are matched against it, so you don’t need to repeat it in the matchers below."
        onBack={() => goBack('/admin/product-forms')}
        backLabel="Back"
      >
        {#snippet titleSlot()}
          <EditableRecordTitle
            value={existing!.label}
            display={existing!.label}
            testId="product-form-label-input"
            editLabel="Edit label"
            error={labelError}
            onCommit={saveLabel}
          />
        {/snippet}

        {#snippet actions()}
          <Button
            data-testid="product-form-delete-button"
            variant="destructive"
            size="sm"
            onclick={handleDelete}
          >
            {#snippet leading()}
              <Icon name="Trash2" size={16} />
            {/snippet}
            Delete
          </Button>
        {/snippet}

        <div class="max-w-xl">
          <RecordEditor record={{ kind: 'form', form: existing }} {saved} />
        </div>
      </DetailPage>
    {:else}
      <DetailPage
        title="Add product form"
        onBack={() => goBack('/admin/product-forms')}
        backLabel="Back"
      >
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
            <Button
              variant="ghost"
              onclick={() => goBack('/admin/product-forms')}
              disabled={createBusy}
            >
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
    {/if}
  </div>
</AdminGuard>
