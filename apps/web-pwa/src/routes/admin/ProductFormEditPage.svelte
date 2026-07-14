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
    deleteProductForm,
  } from '../../lib/productFormService.js';
  import { canonItems } from '../../lib/canonService.js';
  import { titleCase } from '../../lib/titleCase.js';
  import { addToast } from '../../lib/toastStore.js';
  import AdminGuard from './AdminGuard.svelte';

  let { params }: { params: Record<string, string> } = $props();

  const existing = $derived(
    params.id ? ($productForms.find((f) => f.id === params.id) ?? null) : null,
  );
  const isEdit = $derived(!!params.id);

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

  async function handleSave(): Promise<void> {
    errorMessage = '';
    const matchers = matchersText
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    const amountPerParent = parseFloat(amount);
    const input = { matchers, parentCanonId, label, formUnit: unit, amountPerParent };

    busy = true;
    const result =
      isEdit && existing ? await editProductForm(existing, input) : await addProductForm(input);
    busy = false;

    if (result.kind !== 'ok') {
      errorMessage =
        'Please give a label, pick a parent item, add at least one matcher, and a yield amount above 0.';
      return;
    }
    addToast(isEdit ? 'Saved product form' : 'Added product form', 'success');
    push('/admin/product-forms');
  }

  // Delete
  let deleteOpen = $state(false);
  let deleteBusy = $state(false);

  async function handleDelete(): Promise<void> {
    if (!existing) return;
    deleteBusy = true;
    const result = await deleteProductForm(existing.id);
    deleteBusy = false;
    if (result.kind === 'ok') {
      deleteOpen = false;
      addToast(`Deleted ${existing.label}`, 'success');
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
            <Button variant="ghost" onclick={() => push('/admin/product-forms')} disabled={busy}>
              Cancel
            </Button>
            <Button
              data-testid="product-form-save-button"
              onclick={handleSave}
              loading={busy}
              disabled={busy}
            >
              Save
            </Button>
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
