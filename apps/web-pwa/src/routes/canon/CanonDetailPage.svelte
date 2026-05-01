<script lang="ts">
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import {
    Button,
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
    Spinner,
    Text,
    TextField,
  } from '@salt/ui-components';
  import {
    canonItems,
    updateCanonItemName,
    updateCanonItemAisle,
    updateCanonItemSynonyms,
    deleteCanonItem,
  } from '../../lib/canonService.js';
  import { aisles, initAisles } from '../../lib/aisleService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { titleCase } from '../../lib/titleCase.js';

  let { params }: { params: Record<string, string> } = $props();

  onMount(() => {
    void initAisles();
  });

  let item = $derived($canonItems.find((c) => c.id === params.id));

  // Track which item was last initialized so edits aren't wiped on unrelated store updates
  let _initedId = '';

  // Name editing
  let editingName = $state('');
  let nameBusy = $state(false);
  let nameError = $state('');

  // Synonyms editing
  let editingSynonyms = $state('');
  let synonymsBusy = $state(false);
  let synonymsError = $state('');

  // Initialize editing state once per item id
  $effect(() => {
    const current = item;
    if (current && current.id !== _initedId) {
      _initedId = current.id;
      editingName = current.name;
      editingSynonyms = current.synonyms.join(', ');
    }
  });

  async function saveName(): Promise<void> {
    if (!item) return;
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === item.name) return;
    nameBusy = true;
    nameError = '';
    const result = await updateCanonItemName(item, trimmed);
    nameBusy = false;
    if (result.kind !== 'ok') {
      nameError = 'Invalid name.';
    }
  }

  // Aisle editing — save immediately on select
  let aisleBusy = $state(false);

  async function saveAisle(value: string): Promise<void> {
    if (!item) return;
    const newAisleId = value || null;
    if (newAisleId === item.aisleId) return;
    aisleBusy = true;
    await updateCanonItemAisle(item, newAisleId);
    aisleBusy = false;
  }

  async function saveSynonyms(): Promise<void> {
    if (!item) return;
    const synonyms = editingSynonyms
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    synonymsBusy = true;
    synonymsError = '';
    const result = await updateCanonItemSynonyms(item, synonyms);
    synonymsBusy = false;
    if (result.kind !== 'ok') {
      synonymsError = 'Invalid synonyms.';
    }
  }

  // Delete
  let deleteOpen = $state(false);
  let deleteBusy = $state(false);

  async function handleDelete(): Promise<void> {
    if (!item) return;
    const name = titleCase(item.name);
    deleteBusy = true;
    const result = await deleteCanonItem(item.id);
    deleteBusy = false;
    if (result.kind === 'ok') {
      deleteOpen = false;
      addToast(`Deleted ${name}`, 'success');
      push('/canon');
    }
  }
</script>

<div class="p-4 sm:p-6">
  {#if !item}
    <div class="flex flex-col gap-4">
      <div>
        <Button variant="ghost" size="sm" onclick={() => push('/canon')}>
          {#snippet leading()}
            <Icon name="ArrowLeft" size={16} />
          {/snippet}
          Items
        </Button>
      </div>
      <Text muted>Item not found.</Text>
    </div>
  {:else}
    <DetailPage title={titleCase(item.name)} onBack={() => push('/canon')} backLabel="Items">
      {#snippet actions()}
        <Button
          data-testid="canon-detail-delete-button"
          variant="destructive"
          size="sm"
          onclick={() => (deleteOpen = true)}
        >
          {#snippet leading()}
            <Icon name="Trash2" size={16} />
          {/snippet}
          Delete
        </Button>
      {/snippet}

      <div class="flex flex-col gap-6">
        <!-- Name -->
        <section class="flex flex-col gap-2">
          <h2 class="text-sm font-medium text-foreground">Name</h2>
          <div class="flex gap-2">
            <div class="flex-1">
              <TextField
                label=""
                value={editingName}
                onValueChange={(v) => (editingName = v)}
                error={nameError}
                data-testid="canon-detail-name-input"
              />
            </div>
            <Button
              data-testid="canon-detail-name-save"
              variant="outline"
              onclick={saveName}
              loading={nameBusy}
              disabled={nameBusy || !editingName.trim() || editingName.trim() === item.name}
            >
              Save
            </Button>
          </div>
        </section>

        <!-- Aisle -->
        <section class="flex flex-col gap-2">
          <h2 class="text-sm font-medium text-foreground">Aisle</h2>
          <div class="flex items-center gap-2">
            <div class="flex-1" data-testid="canon-detail-aisle-select">
              <Select value={item.aisleId ?? ''} onValueChange={saveAisle} disabled={aisleBusy}>
                <SelectTrigger>
                  {item.aisleId
                    ? titleCase($aisles.find((a) => a.id === item?.aisleId)?.name ?? 'Unknown')
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
            {#if aisleBusy}
              <Spinner size={16} />
            {/if}
          </div>
        </section>

        <!-- Synonyms -->
        <section class="flex flex-col gap-2">
          <h2 class="text-sm font-medium text-foreground">Synonyms</h2>
          <p class="text-xs text-muted-foreground">Separate multiple synonyms with commas.</p>
          <div class="flex gap-2">
            <div class="flex-1">
              <TextField
                label=""
                value={editingSynonyms}
                onValueChange={(v) => (editingSynonyms = v)}
                error={synonymsError}
                placeholder="e.g. Butter, Unsalted butter"
                data-testid="canon-detail-synonyms-input"
              />
            </div>
            <Button
              data-testid="canon-detail-synonyms-save"
              variant="outline"
              onclick={saveSynonyms}
              loading={synonymsBusy}
              disabled={synonymsBusy}
            >
              Save
            </Button>
          </div>
        </section>
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
    <div data-testid="canon-detail-delete-dialog">
      <DialogHeader>
        <DialogTitle>Delete "{titleCase(item?.name ?? '')}"?</DialogTitle>
        <DialogDescription>This action cannot be undone.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onclick={() => (deleteOpen = false)} disabled={deleteBusy}>
          Cancel
        </Button>
        <Button
          data-testid="canon-detail-delete-confirm"
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
