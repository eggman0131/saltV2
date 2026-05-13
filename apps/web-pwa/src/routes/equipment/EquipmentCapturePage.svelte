<script lang="ts">
  import { Button, Checkbox, FormPage, Spinner, TextField } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    callIdentifyEquipment,
    callPopulateEquipmentEntry,
    addEquipmentItem,
    addEquipmentAccessory,
    equipment,
  } from '../../lib/equipmentService.js';
  import { addToast } from '../../lib/toastStore.js';
  import type { IdentifyEquipmentCandidate } from '@salt/firebase-sync';

  // ─── Step machine ─────────────────────────────────────────────────────────
  // step 1: raw name entry
  // step 2: pick AI candidate (or confirm custom)
  // step 3: review/edit AI accessories + manual add
  type Step = 1 | 2 | 3;
  let step = $state<Step>(1);

  // ─── Step 1 ───────────────────────────────────────────────────────────────
  let rawName = $state('');
  let identifyBusy = $state(false);
  let candidates = $state<readonly IdentifyEquipmentCandidate[]>([]);

  async function handleIdentify(): Promise<void> {
    const name = rawName.trim();
    if (!name) return;
    identifyBusy = true;
    const result = await callIdentifyEquipment(name);
    identifyBusy = false;
    if (result.kind !== 'ok') {
      addToast('Could not reach AI. You can still type the name manually.', 'error');
      candidates = [];
    } else {
      candidates = result.value.candidates;
    }
    step = 2;
  }

  // ─── Step 2 ───────────────────────────────────────────────────────────────
  let confirmedName = $state('');
  let populateBusy = $state(false);

  interface DraftAccessory {
    id: string;
    name: string;
    owned: boolean;
    included: boolean;
  }
  let draftAccessories = $state<DraftAccessory[]>([]);

  function pickCandidate(name: string): void {
    confirmedName = name;
  }

  async function handleConfirm(): Promise<void> {
    const name = confirmedName.trim() || rawName.trim();
    if (!name) return;
    confirmedName = name;
    populateBusy = true;
    const result = await callPopulateEquipmentEntry(name);
    populateBusy = false;
    if (result.kind !== 'ok') {
      addToast('Could not fetch accessories. You can add them manually.', 'error');
      draftAccessories = [];
    } else {
      // Phase 3 contract: no id, no owned in response — mint both here
      draftAccessories = result.value.accessories.map((a) => ({
        id: crypto.randomUUID(),
        name: a.name,
        owned: false,
        included: a.included,
      }));
    }
    step = 3;
  }

  // ─── Step 3 ───────────────────────────────────────────────────────────────
  let newAccessoryName = $state('');
  let saveBusy = $state(false);

  function addManualAccessory(): void {
    const name = newAccessoryName.trim();
    if (!name) return;
    draftAccessories = [
      ...draftAccessories,
      { id: crypto.randomUUID(), name, owned: false, included: false },
    ];
    newAccessoryName = '';
  }

  function removeDraftAccessory(id: string): void {
    draftAccessories = draftAccessories.filter((a) => a.id !== id);
  }

  function toggleDraftOwned(id: string): void {
    draftAccessories = draftAccessories.map((a) => (a.id === id ? { ...a, owned: !a.owned } : a));
  }

  async function handleSave(): Promise<void> {
    saveBusy = true;

    // Create the equipment item first
    const addResult = await addEquipmentItem(confirmedName);
    if (addResult.kind !== 'ok') {
      saveBusy = false;
      addToast('Failed to save equipment.', 'error');
      return;
    }

    // Find the newly created item's id (it's the last item added)
    const manifest = addResult.value;
    const newItem = manifest.items.find((i) => i.name === confirmedName);
    if (!newItem) {
      saveBusy = false;
      addToast('Failed to save equipment.', 'error');
      return;
    }

    // Add each accessory sequentially
    for (const acc of draftAccessories) {
      await addEquipmentAccessory(newItem.id, acc.name, acc.owned, acc.included);
    }

    saveBusy = false;
    addToast(`Added ${confirmedName}`, 'success');
    push(`/equipment/${newItem.id}`);
  }

  const canIdentify = $derived(rawName.trim().length > 0 && !identifyBusy);
  const canConfirm = $derived((confirmedName.trim() || rawName.trim()).length > 0 && !populateBusy);
  const canSave = $derived(!saveBusy);
</script>

{#if step === 1}
  <FormPage
    title="Add equipment"
    description="Type your appliance or tool name."
    submitLabel="Identify"
    isSubmitting={identifyBusy}
    canSubmit={canIdentify}
    onSubmit={handleIdentify}
    onCancel={() => push('/equipment')}
    class="p-4 sm:p-6"
  >
    <div class="flex flex-col gap-1.5">
      <label class="text-sm font-medium" for="equipment-raw-name">Name</label>
      <TextField
        id="equipment-raw-name"
        bind:value={rawName}
        placeholder="e.g. KitchenAid Artisan, Magimix 5200XL…"
        disabled={identifyBusy}
        data-testid="equipment-raw-name-input"
        autofocus
      />
    </div>
  </FormPage>
{:else if step === 2}
  <FormPage
    title="Confirm name"
    description="Select a suggested name or keep what you typed."
    submitLabel={populateBusy ? 'Loading…' : 'Confirm'}
    isSubmitting={populateBusy}
    canSubmit={canConfirm}
    onSubmit={handleConfirm}
    class="p-4 sm:p-6"
  >
    {#snippet footer()}
      <div class="flex w-full items-center justify-between border-t border-border pt-4">
        <Button variant="ghost" onclick={() => (step = 1)} disabled={populateBusy}>Back</Button>
        <Button
          type="submit"
          loading={populateBusy}
          disabled={!canConfirm}
          data-testid="equipment-confirm-name-btn"
        >
          Confirm
        </Button>
      </div>
    {/snippet}

    <div class="flex flex-col gap-3">
      {#if candidates.length > 0}
        <p class="text-sm text-muted-foreground">AI suggestions:</p>
        <ul class="flex flex-col gap-2">
          {#each candidates as candidate (candidate.name)}
            <li>
              <button
                type="button"
                class="w-full rounded-lg border px-4 py-3 text-left text-sm transition-colors {confirmedName ===
                candidate.name
                  ? 'border-primary bg-primary/5 font-medium'
                  : 'border-border bg-card hover:border-primary/50'}"
                onclick={() => pickCandidate(candidate.name)}
                data-testid="equipment-candidate"
              >
                <span class="font-medium">{candidate.name}</span>
                <span class="mt-0.5 block text-xs text-muted-foreground">{candidate.rationale}</span
                >
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium" for="equipment-confirmed-name">
          {candidates.length > 0 ? 'Or type a custom name:' : 'Name:'}
        </label>
        <TextField
          id="equipment-confirmed-name"
          bind:value={confirmedName}
          placeholder={rawName}
          disabled={populateBusy}
          data-testid="equipment-confirmed-name-input"
        />
      </div>
    </div>
  </FormPage>
{:else}
  <FormPage
    title={confirmedName}
    description="Review AI-suggested accessories, toggle ownership, and add any extras."
    submitLabel="Save"
    isSubmitting={saveBusy}
    canSubmit={canSave}
    onSubmit={handleSave}
    class="p-4 sm:p-6"
  >
    {#snippet footer()}
      <div class="flex w-full items-center justify-between border-t border-border pt-4">
        <Button variant="ghost" onclick={() => (step = 2)} disabled={saveBusy}>Back</Button>
        <Button
          type="submit"
          loading={saveBusy}
          disabled={!canSave}
          data-testid="equipment-save-btn"
        >
          Save
        </Button>
      </div>
    {/snippet}

    <div class="flex flex-col gap-4">
      <!-- Accessory list -->
      {#if draftAccessories.length > 0}
        <div class="flex flex-col gap-2">
          <p class="text-sm font-medium">Accessories</p>
          <ul class="flex flex-col gap-1" data-testid="equipment-accessory-list">
            {#each draftAccessories as acc (acc.id)}
              <li
                class="flex items-center gap-3 rounded border border-border bg-card px-3 py-2 text-sm"
                data-testid="equipment-draft-accessory"
              >
                <Checkbox
                  checked={acc.owned}
                  onCheckedChange={() => toggleDraftOwned(acc.id)}
                  label=""
                  aria-label="Owned"
                />
                <span class="flex-1">
                  {acc.name}
                  {#if acc.included}
                    <span class="ml-1 text-xs text-muted-foreground">(included)</span>
                  {/if}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => removeDraftAccessory(acc.id)}
                  aria-label="Remove {acc.name}"
                >
                  Remove
                </Button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <!-- Manual add -->
      <div class="flex flex-col gap-1.5">
        <p class="text-sm font-medium">Add accessory</p>
        <div class="flex gap-2">
          <TextField
            bind:value={newAccessoryName}
            placeholder="Accessory name…"
            class="flex-1"
            data-testid="equipment-new-accessory-input"
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addManualAccessory();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            onclick={addManualAccessory}
            disabled={!newAccessoryName.trim()}
          >
            Add
          </Button>
        </div>
      </div>

      {#if saveBusy}
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size={16} />
          Saving…
        </div>
      {/if}
    </div>
  </FormPage>
{/if}
