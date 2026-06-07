<script lang="ts">
  import { push } from 'svelte-spa-router';
  import {
    Button,
    Combobox,
    ComboboxContent,
    ComboboxCreate,
    ComboboxEmpty,
    ComboboxField,
    ComboboxInput,
    ComboboxItem,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    Spinner,
  } from '@salt/ui-components';
  import { canonItems, addCanonItem } from '../../lib/canonService.js';
  import { aisles } from '../../lib/aisleService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { titleCase } from '../../lib/titleCase.js';
  import AdminGuard from '../admin/AdminGuard.svelte';

  let comboItems = $derived($canonItems.map((c) => ({ value: c.id, label: titleCase(c.name) })));

  // Case-insensitive substring match on name and synonyms
  function filterFn(input: string, comboItem: { value: string; label: string }): boolean {
    const q = input.trim().toLowerCase();
    if (!q) return true;
    const canon = $canonItems.find((c) => c.id === comboItem.value);
    return (
      comboItem.label.toLowerCase().includes(q) ||
      (canon?.synonyms.some((s) => s.toLowerCase().includes(q)) ?? false)
    );
  }

  let selectedAisleId = $state<string | null>(null);
  let pending = $state(false);
  let errorMessage = $state('');

  // Selecting an existing item from the combobox navigates to its detail page
  function handleValueChange(id: string): void {
    if ($canonItems.some((c) => c.id === id)) {
      push(`/admin/canon/${id}`);
    }
  }

  // Submitting a new name triggers the matching pipeline; the pipeline always
  // resolves to a single CanonItem, so we navigate straight to it.
  async function handleCreate(name: string): Promise<void> {
    pending = true;
    errorMessage = '';
    const result = await addCanonItem(name, selectedAisleId);
    pending = false;

    if (result.kind !== 'ok') {
      errorMessage = 'Failed to save item. Please try again.';
      return;
    }

    const { item, decision } = result.value;
    const toastMessage =
      decision === 'created'
        ? `Added ${titleCase(item.name)}`
        : `Matched to ${titleCase(item.name)}`;
    addToast(toastMessage, 'success');
    push(`/admin/canon/${item.id}`);
  }
</script>

<AdminGuard>
  <div class="p-4 sm:p-6">
    <div class="flex flex-col gap-6">
      <header class="flex flex-col gap-1">
        <h1 class="text-xl font-semibold tracking-tight text-foreground">Add item</h1>
        <p class="text-sm text-muted-foreground">
          Search for an existing item or type a new name to add one.
        </p>
      </header>

      <div class="flex flex-col gap-4">
        <!-- Name combobox -->
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium" for="item-combobox">Name</label>
          <Combobox
            items={comboItems}
            allowCustom={true}
            {filterFn}
            onValueChange={handleValueChange}
            onCreate={handleCreate}
            placeholder="Search or type a new item…"
          >
            <ComboboxField>
              <ComboboxInput />
            </ComboboxField>
            <ComboboxContent>
              {#snippet children({ filteredItems, showCreate })}
                {#each filteredItems as item, i (item.value)}
                  <ComboboxItem {item} index={i} />
                {/each}
                {#if showCreate}
                  <ComboboxCreate />
                {/if}
                {#if filteredItems.length === 0 && !showCreate}
                  <ComboboxEmpty>No matches found</ComboboxEmpty>
                {/if}
              {/snippet}
            </ComboboxContent>
          </Combobox>
        </div>

        <!-- Optional aisle -->
        <div class="flex flex-col gap-1.5">
          <p class="text-sm font-medium">
            Aisle <span class="font-normal text-muted-foreground">(optional)</span>
          </p>
          <Select
            value={selectedAisleId ?? ''}
            onValueChange={(v) => (selectedAisleId = v || null)}
          >
            <SelectTrigger>
              {selectedAisleId
                ? titleCase($aisles.find((a) => a.id === selectedAisleId)?.name ?? 'Unknown')
                : 'No aisle'}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">No aisle</SelectItem>
              {#each $aisles as aisle (aisle.id)}
                <SelectItem value={aisle.id}>{titleCase(aisle.name)}</SelectItem>
              {/each}
            </SelectContent>
          </Select>
        </div>
      </div>

      {#if pending}
        <div
          data-testid="canon-create-pending"
          class="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner size={16} />
          Checking for matches…
        </div>
      {/if}

      {#if errorMessage}
        <p class="text-sm text-destructive">{errorMessage}</p>
      {/if}

      <div class="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" onclick={() => push('/admin/canon')}>Cancel</Button>
      </div>
    </div>
  </div>
</AdminGuard>
