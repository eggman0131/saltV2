<script lang="ts">
  import { push } from 'svelte-spa-router';
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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
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
    confirmProductForm,
    deleteProductForm,
  } from '../../lib/productFormService.js';
  import { canonItems } from '../../lib/canonService.js';
  import { titleCase } from '../../lib/titleCase.js';
  import { addToast } from '../../lib/toastStore.js';
  import AdminGuard from './AdminGuard.svelte';

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
  // An AI-seeded proposal (issue #500, Phase 3) awaiting review. It already
  // resolves recipes live; Confirm records the review + persists any edits.
  const isPending = $derived(!!existing?.needs_approval);
  // Phase 2: the parent canon may itself be a freshly-minted, unconfirmed item
  // (no stored back-reference — derived from the subscribed canonItems). When it
  // is, flag it so the reviewer knows the parent is new too.
  const parentPending = $derived(
    isPending && $canonItems.find((c) => c.id === existing?.parentCanonId)?.needs_approval === true,
  );

  // Editable fields
  let matchersText = $state('');
  let parentCanonId = $state('');
  let label = $state('');
  let amount = $state('');
  let unit = $state<CanonItemUnit>('ml');

  let busy = $state(false);
  let errorMessage = $state('');
  let _initedId = $state('');

  // Seed fields once when editing an existing form.
  $effect(() => {
    const f = existing;
    if (f && f.id !== _initedId) {
      _initedId = f.id;
      matchersText = f.matchers.join(', ');
      parentCanonId = f.parentCanonId;
      label = f.label;
      amount = f.yield.amountPerParent.toString();
      unit = f.yield.formUnit;
    }
  });

  const canonComboItems = $derived(
    $canonItems.map((c) => ({ value: c.id, label: titleCase(c.name) })),
  );

  function buildInput() {
    const matchers = matchersText
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    return { matchers, parentCanonId, label, formUnit: unit, amountPerParent: parseFloat(amount) };
  }

  const invalidMessage =
    'Please give a label, pick a parent item, add at least one matcher, and a yield amount above 0.';

  async function handleSave(): Promise<void> {
    errorMessage = '';
    const input = buildInput();

    busy = true;
    const result =
      isEdit && existing ? await editProductForm(existing, input) : await addProductForm(input);
    busy = false;

    if (result.kind !== 'ok') {
      errorMessage = invalidMessage;
      return;
    }
    addToast(isEdit ? 'Saved product form' : 'Added product form', 'success');
    push('/admin/product-forms');
  }

  // Confirm a pending proposal: persist any reviewed edits AND clear the
  // needs-review flag in one write, then return to the list.
  let confirmBusy = $state(false);
  async function handleConfirm(): Promise<void> {
    if (!existing) return;
    errorMessage = '';
    confirmBusy = true;
    const result = await confirmProductForm(existing, buildInput());
    confirmBusy = false;
    if (result.kind !== 'ok') {
      errorMessage = invalidMessage;
      return;
    }
    addToast('Confirmed product form', 'success');
    push('/admin/product-forms');
  }

  // Delete
  let deleteOpen = $state(false);
  let deleteBusy = $state(false);

  async function handleDelete(): Promise<void> {
    // Capture the form BEFORE the await. `existing` is derived from the live
    // productForms subscription, so the moment the delete lands the doc leaves the
    // store and `existing` becomes null — reading `existing.label` afterwards threw,
    // which skipped the push() below and stranded the user on this page's
    // "Form not found." branch. CanonDetailPage captures its name for the same reason.
    const target = existing;
    if (!target) return;
    deleteBusy = true;
    const result = await deleteProductForm(target.id);
    deleteBusy = false;
    if (result.kind === 'ok') {
      deleteOpen = false;
      addToast(`Deleted ${target.label}`, 'success');
      push('/admin/product-forms');
    }
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
    {:else}
      <DetailPage
        title={isEdit ? label || 'Edit form' : 'Add product form'}
        onBack={() => push('/admin/product-forms')}
        backLabel="Product forms"
      >
        {#snippet actions()}
          {#if isEdit}
            <Button
              data-testid="product-form-delete-button"
              variant="destructive"
              size="sm"
              onclick={() => (deleteOpen = true)}
            >
              {#snippet leading()}
                <Icon name="Trash2" size={16} />
              {/snippet}
              Delete
            </Button>
          {/if}
        {/snippet}

        <div class="flex max-w-xl flex-col gap-4">
          {#if isPending}
            <div
              class="flex flex-col gap-1 rounded border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30"
              data-testid="product-form-review-banner"
            >
              <h2 class="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Review before confirming
              </h2>
              <p class="text-sm text-amber-900 dark:text-amber-200">
                This mapping was proposed automatically while importing a recipe and is already
                being used. Check the parent item and yield below, then Confirm.
              </p>
              {#if parentPending}
                <p class="text-sm text-amber-900 dark:text-amber-200">
                  The parent item was auto-created too and is still awaiting review.
                  <button
                    type="button"
                    class="font-medium underline underline-offset-2"
                    data-testid="product-form-parent-pending"
                    onclick={() => push(`/admin/canon/${existing?.parentCanonId}`)}
                  >
                    Review the parent
                  </button>
                </p>
              {/if}
            </div>
          {/if}

          <TextField
            label="Label"
            description="How this form reads, e.g. “freshly squeezed lime juice”."
            value={label}
            onValueChange={(v) => (label = v)}
            placeholder="e.g. freshly squeezed lime juice"
            data-testid="product-form-label-input"
          />

          <TextField
            label="Matchers"
            description="Comma-separated phrases that identify this form, e.g. “lime juice”."
            value={matchersText}
            onValueChange={(v) => (matchersText = v)}
            placeholder="e.g. lime juice, fresh lime juice"
            data-testid="product-form-matchers-input"
          />

          <!-- Parent canon item -->
          <div class="flex flex-col gap-1.5">
            <span class="text-sm font-medium text-foreground">Parent item</span>
            <div data-testid="product-form-parent-select">
              <Combobox
                items={canonComboItems}
                value={parentCanonId}
                onValueChange={(v) => (parentCanonId = v)}
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

          <!-- Yield -->
          <div class="flex items-end gap-2">
            <div class="flex-1">
              <TextField
                label="Yield per parent"
                inputmode="decimal"
                value={amount}
                onValueChange={(v) => (amount = v)}
                placeholder="e.g. 30"
                data-testid="product-form-amount-input"
              />
            </div>
            <div class="w-28">
              <Select value={unit} onValueChange={(v) => (unit = v as CanonItemUnit)}>
                <SelectTrigger data-testid="product-form-unit-select">{unit}</SelectTrigger>
                <SelectContent>
                  <SelectItem value="g">g</SelectItem>
                  <SelectItem value="ml">ml</SelectItem>
                  <SelectItem value="count">count</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {#if errorMessage}
            <p class="text-sm text-destructive">{errorMessage}</p>
          {/if}

          <div class="flex justify-end gap-2 border-t border-border pt-4">
            <Button
              variant="ghost"
              onclick={() => push('/admin/product-forms')}
              disabled={busy || confirmBusy}
            >
              Cancel
            </Button>
            <Button
              data-testid="product-form-save-button"
              variant={isPending ? 'outline' : 'solid'}
              onclick={handleSave}
              loading={busy}
              disabled={busy || confirmBusy}
            >
              Save
            </Button>
            {#if isPending}
              <Button
                data-testid="product-form-confirm-button"
                onclick={handleConfirm}
                loading={confirmBusy}
                disabled={busy || confirmBusy}
              >
                Confirm
              </Button>
            {/if}
          </div>
        </div>
      </DetailPage>
    {/if}
  </div>

  <!-- Delete confirm dialog -->
  <Dialog
    bind:open={deleteOpen}
    onOpenChange={(v) => {
      if (!v) deleteBusy = false;
    }}
  >
    <DialogContent>
      <div class="flex flex-col gap-4" data-testid="product-form-delete-dialog">
        <DialogHeader>
          <DialogTitle>Delete "{existing?.label ?? ''}"?</DialogTitle>
          <DialogDescription>This action cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onclick={() => (deleteOpen = false)} disabled={deleteBusy}>
            Cancel
          </Button>
          <Button
            data-testid="product-form-delete-confirm"
            variant="destructive"
            onclick={handleDelete}
            loading={deleteBusy}
            disabled={deleteBusy}
          >
            Delete
          </Button>
        </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>
</AdminGuard>
