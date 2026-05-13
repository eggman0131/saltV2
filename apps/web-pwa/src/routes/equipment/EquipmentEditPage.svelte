<script lang="ts">
  import { Button, Checkbox, DetailPage, TextField, Spinner } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    equipment,
    renameEquipmentItem,
    addEquipmentAccessory,
    removeEquipmentAccessory,
    toggleEquipmentAccessoryOwned,
    addEquipmentRule,
    removeEquipmentRule,
    editEquipmentRule,
  } from '../../lib/equipmentService.js';
  import { addToast } from '../../lib/toastStore.js';

  interface Props {
    params: { id: string };
  }
  let { params }: Props = $props();

  const item = $derived($equipment?.items.find((i) => i.id === params.id) ?? null);

  // ─── Rename ───────────────────────────────────────────────────────────────
  let renameDraft = $state('');
  let renameBusy = $state(false);
  let renameMode = $state(false);

  function startRename(): void {
    renameDraft = item?.name ?? '';
    renameMode = true;
  }

  async function commitRename(): Promise<void> {
    if (!renameDraft.trim() || !item) return;
    renameBusy = true;
    const result = await renameEquipmentItem(item.id, renameDraft);
    renameBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to rename.', 'error');
    } else {
      renameMode = false;
    }
  }

  // ─── Accessories ──────────────────────────────────────────────────────────
  let newAccessoryName = $state('');
  let accessoryBusy = $state(false);

  async function handleAddAccessory(): Promise<void> {
    if (!newAccessoryName.trim() || !item) return;
    accessoryBusy = true;
    const result = await addEquipmentAccessory(item.id, newAccessoryName, false, false);
    accessoryBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to add accessory.', 'error');
    } else {
      newAccessoryName = '';
    }
  }

  async function handleRemoveAccessory(accessoryId: string): Promise<void> {
    if (!item) return;
    const result = await removeEquipmentAccessory(item.id, accessoryId);
    if (result.kind !== 'ok') addToast('Failed to remove accessory.', 'error');
  }

  async function handleToggleOwned(accessoryId: string, currentOwned: boolean): Promise<void> {
    if (!item) return;
    const result = await toggleEquipmentAccessoryOwned(item.id, accessoryId, !currentOwned);
    if (result.kind !== 'ok') addToast('Failed to update accessory.', 'error');
  }

  // ─── Rules ────────────────────────────────────────────────────────────────
  let newRuleText = $state('');
  let ruleBusy = $state(false);
  let editingRuleIndex = $state<number | null>(null);
  let editingRuleDraft = $state('');

  async function handleAddRule(): Promise<void> {
    if (!newRuleText.trim() || !item) return;
    ruleBusy = true;
    const result = await addEquipmentRule(item.id, newRuleText);
    ruleBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to add rule.', 'error');
    } else {
      newRuleText = '';
    }
  }

  async function handleRemoveRule(ruleIndex: number): Promise<void> {
    if (!item) return;
    const result = await removeEquipmentRule(item.id, ruleIndex);
    if (result.kind !== 'ok') addToast('Failed to remove rule.', 'error');
  }

  function startEditRule(index: number): void {
    editingRuleIndex = index;
    editingRuleDraft = item?.rules[index] ?? '';
  }

  async function commitEditRule(): Promise<void> {
    if (editingRuleIndex === null || !item) return;
    const result = await editEquipmentRule(item.id, editingRuleIndex, editingRuleDraft);
    if (result.kind !== 'ok') {
      addToast('Failed to update rule.', 'error');
    } else {
      editingRuleIndex = null;
    }
  }
</script>

{#if item === null}
  <div class="p-4 sm:p-6">
    <p class="text-sm text-muted-foreground">Equipment item not found.</p>
    <Button variant="outline" class="mt-4" onclick={() => push('/equipment')}
      >Back to kitchen</Button
    >
  </div>
{:else}
  <DetailPage
    title={item.name}
    onBack={() => push('/equipment')}
    backLabel="Kitchen"
    class="p-4 sm:p-6"
  >
    {#snippet actions()}
      {#if !renameMode}
        <Button
          variant="outline"
          size="sm"
          onclick={startRename}
          data-testid="equipment-rename-btn"
        >
          Rename
        </Button>
      {/if}
    {/snippet}

    <div class="flex flex-col gap-8">
      <!-- Rename section -->
      {#if renameMode}
        <section class="flex flex-col gap-2">
          <p class="text-sm font-medium">Rename</p>
          <div class="flex gap-2">
            <TextField
              bind:value={renameDraft}
              disabled={renameBusy}
              class="flex-1"
              data-testid="equipment-rename-input"
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void commitRename();
                }
                if (e.key === 'Escape') renameMode = false;
              }}
              autofocus
            />
            <Button onclick={commitRename} loading={renameBusy} disabled={!renameDraft.trim()}>
              Save
            </Button>
            <Button variant="ghost" onclick={() => (renameMode = false)} disabled={renameBusy}>
              Cancel
            </Button>
          </div>
        </section>
      {/if}

      <!-- Accessories section -->
      <section class="flex flex-col gap-3">
        <p class="text-sm font-medium">
          Accessories
          {#if item.accessories.length > 0}
            <span class="font-normal text-muted-foreground">({item.accessories.length})</span>
          {/if}
        </p>

        {#if item.accessories.length > 0}
          <ul class="flex flex-col gap-1" data-testid="equipment-accessories">
            {#each item.accessories as acc (acc.id)}
              <li
                class="flex items-center gap-3 rounded border border-border bg-card px-3 py-2 text-sm"
                data-testid="equipment-accessory-row"
                data-accessory-id={acc.id}
              >
                <Checkbox
                  checked={acc.owned}
                  onCheckedChange={() => void handleToggleOwned(acc.id, acc.owned)}
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
                  onclick={() => void handleRemoveAccessory(acc.id)}
                  aria-label="Remove {acc.name}"
                >
                  Remove
                </Button>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm text-muted-foreground">No accessories yet.</p>
        {/if}

        <div class="flex gap-2">
          <TextField
            bind:value={newAccessoryName}
            placeholder="Add accessory…"
            disabled={accessoryBusy}
            class="flex-1"
            data-testid="equipment-add-accessory-input"
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAddAccessory();
              }
            }}
          />
          <Button
            variant="outline"
            onclick={handleAddAccessory}
            loading={accessoryBusy}
            disabled={!newAccessoryName.trim() || accessoryBusy}
            data-testid="equipment-add-accessory-btn"
          >
            Add
          </Button>
        </div>
      </section>

      <!-- Rules section -->
      <section class="flex flex-col gap-3">
        <p class="text-sm font-medium">
          Rules
          {#if item.rules.length > 0}
            <span class="font-normal text-muted-foreground">({item.rules.length})</span>
          {/if}
        </p>
        <p class="text-xs text-muted-foreground">
          Plain-English instructions that correct how AI uses this equipment in recipes.
        </p>

        {#if item.rules.length > 0}
          <ul class="flex flex-col gap-2" data-testid="equipment-rules">
            {#each item.rules as rule, idx (idx)}
              <li
                class="flex flex-col gap-1 rounded border border-border bg-card px-3 py-2 text-sm"
                data-testid="equipment-rule-row"
                data-rule-index={idx}
              >
                {#if editingRuleIndex === idx}
                  <div class="flex gap-2">
                    <TextField
                      bind:value={editingRuleDraft}
                      class="flex-1"
                      data-testid="equipment-edit-rule-input"
                      onkeydown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void commitEditRule();
                        }
                        if (e.key === 'Escape') editingRuleIndex = null;
                      }}
                      autofocus
                    />
                    <Button size="sm" onclick={commitEditRule} disabled={!editingRuleDraft.trim()}>
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" onclick={() => (editingRuleIndex = null)}>
                      Cancel
                    </Button>
                  </div>
                {:else}
                  <div class="flex items-start gap-2">
                    <span class="flex-1" data-testid="equipment-rule-text">{rule}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => startEditRule(idx)}
                      aria-label="Edit rule"
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onclick={() => void handleRemoveRule(idx)}
                      aria-label="Remove rule"
                    >
                      Remove
                    </Button>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {:else}
          <p class="text-sm text-muted-foreground">No rules yet.</p>
        {/if}

        <!-- Add rule -->
        <div class="flex gap-2">
          <TextField
            bind:value={newRuleText}
            placeholder="e.g. Always use the dough hook for bread"
            disabled={ruleBusy}
            class="flex-1"
            data-testid="equipment-add-rule-input"
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAddRule();
              }
            }}
          />
          <Button
            variant="outline"
            onclick={handleAddRule}
            loading={ruleBusy}
            disabled={!newRuleText.trim() || ruleBusy}
            data-testid="equipment-add-rule-btn"
          >
            Add rule
          </Button>
        </div>
      </section>
    </div>
  </DetailPage>
{/if}
