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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    Spinner,
  } from '@salt/ui-components';
  import { canonItems, addCanonItem, confirmCanonMatch } from '../../lib/canonService.js';
  import { aisles } from '../../lib/aisleService.js';
  import type { CanonItem } from '@salt/domain';
  import { addToast } from '../../lib/toastStore.js';
  import { titleCase } from '../../lib/titleCase.js';

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

  // Match/candidates confirm dialog
  let matchDialogOpen = $state(false);
  let matchCandidates = $state<CanonItem[]>([]);
  let selectedCandidateId = $state<string | null>(null);
  let pendingName = $state('');
  let pendingAisleId = $state<string | null>(null);
  let overrideBusy = $state(false);

  const selectedCandidate = $derived(
    matchCandidates.find((c) => c.id === selectedCandidateId) ?? null,
  );

  // Selecting an existing item from the combobox navigates to its detail page
  function handleValueChange(id: string): void {
    if ($canonItems.some((c) => c.id === id)) {
      push(`/canon/${id}`);
    }
  }

  // Submitting a new name triggers the matching pipeline
  async function handleCreate(name: string): Promise<void> {
    pendingName = name;
    pendingAisleId = selectedAisleId;
    pending = true;
    errorMessage = '';
    const result = await addCanonItem(name, selectedAisleId);
    pending = false;

    if (result.kind !== 'ok') {
      errorMessage = 'Failed to save item. Please try again.';
      return;
    }

    const outcome = result.value;

    if (outcome.decision === 'created') {
      addToast(`Added ${titleCase(outcome.item.name)}`, 'success');
      push(`/canon/${outcome.item.id}`);
    } else if (outcome.decision === 'candidates') {
      matchCandidates = [...outcome.candidates];
      selectedCandidateId = outcome.candidates[0]?.id ?? null;
      matchDialogOpen = true;
    } else {
      // 'matched' | 'ai_arbitrated' — single confirmed match
      matchCandidates = [outcome.item];
      selectedCandidateId = outcome.item.id;
      matchDialogOpen = true;
    }
  }

  async function handleUseExisting(): Promise<void> {
    matchDialogOpen = false;
    if (selectedCandidate) await confirmCanonMatch(selectedCandidate, pendingName);
    if (selectedCandidateId) push(`/canon/${selectedCandidateId}`);
  }

  async function handleForceCreate(): Promise<void> {
    overrideBusy = true;
    const result = await addCanonItem(pendingName, pendingAisleId, true);
    overrideBusy = false;

    if (result.kind !== 'ok') {
      addToast('Failed to create item. Please try again.', 'destructive');
      return;
    }

    matchDialogOpen = false;
    addToast(`Added ${titleCase(result.value.item.name)}`);
    push(`/canon/${result.value.item.id}`);
  }
</script>

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
        <Select value={selectedAisleId ?? ''} onValueChange={(v) => (selectedAisleId = v || null)}>
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
      <Button variant="ghost" onclick={() => push('/canon')}>Cancel</Button>
    </div>
  </div>
</div>

<!-- Match / candidates confirm dialog -->
<Dialog bind:open={matchDialogOpen}>
  <DialogContent>
    <div data-testid="canon-create-match-dialog" class="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>
          {matchCandidates.length > 1 ? 'Similar items found' : 'This looks like an existing item'}
        </DialogTitle>
        <DialogDescription>
          {#if matchCandidates.length > 1}
            We found {matchCandidates.length} items that may already cover this. Select one to use it,
            or create a new item anyway.
          {:else if selectedCandidate}
            We found a match: <strong>{titleCase(selectedCandidate.name)}</strong>
            {#if selectedCandidate.aisleId}
              {@const aisle = $aisles.find((a) => a.id === selectedCandidate.aisleId)}
              {#if aisle}(aisle: {titleCase(aisle.name)}){/if}
            {/if}
            . Would you like to use it, or create a new one anyway?
          {/if}
        </DialogDescription>
      </DialogHeader>

      {#if matchCandidates.length > 1}
        <Select
          value={selectedCandidateId ?? ''}
          onValueChange={(v) => (selectedCandidateId = v || null)}
          data-testid="canon-create-candidate-select"
        >
          <SelectTrigger>
            {selectedCandidate ? titleCase(selectedCandidate.name) : 'Select an item'}
          </SelectTrigger>
          <SelectContent>
            {#each matchCandidates as candidate (candidate.id)}
              {@const aisle = $aisles.find((a) => a.id === candidate.aisleId)}
              <SelectItem value={candidate.id}>
                {titleCase(candidate.name)}{aisle ? ` — ${titleCase(aisle.name)}` : ''}
              </SelectItem>
            {/each}
          </SelectContent>
        </Select>
      {/if}

      <DialogFooter>
        <Button
          data-testid="canon-create-use-existing"
          variant="outline"
          disabled={!selectedCandidateId}
          onclick={handleUseExisting}
          >{matchCandidates.length > 1 ? 'Use selected' : 'Use existing'}</Button
        >
        <Button
          data-testid="canon-create-create-anyway"
          onclick={handleForceCreate}
          loading={overrideBusy}
          disabled={overrideBusy}
        >
          Create anyway
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
