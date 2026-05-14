<script lang="ts">
  import {
    Button,
    Checkbox,
    DetailPage,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    Icon,
    TextField,
  } from '@salt/ui-components';
  import { push } from 'svelte-spa-router';
  import {
    equipment,
    renameEquipmentItem,
    removeEquipmentItem,
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

  // ─── Name editing (inline, pencil-triggered) ──────────────────────────────
  let editingName = $state('');
  let editingNameActive = $state(false);
  let nameInput = $state<HTMLInputElement | undefined>(undefined);
  let nameBusy = $state(false);

  $effect(() => {
    if (editingNameActive && nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  });

  function startEditName(): void {
    if (!item) return;
    editingName = item.name;
    editingNameActive = true;
  }

  async function commitEditName(): Promise<void> {
    if (!item) return;
    const trimmed = editingName.trim();
    if (!trimmed || trimmed === item.name) {
      editingNameActive = false;
      return;
    }
    nameBusy = true;
    const result = await renameEquipmentItem(item.id, trimmed);
    nameBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to rename.', 'error');
    } else {
      editingNameActive = false;
    }
  }

  // ─── Delete equipment ─────────────────────────────────────────────────────
  let deleteOpen = $state(false);
  let deleteBusy = $state(false);

  async function handleDelete(): Promise<void> {
    if (!item) return;
    const name = item.name;
    deleteBusy = true;
    const result = await removeEquipmentItem(item.id);
    deleteBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to delete equipment.', 'error');
      return;
    }
    deleteOpen = false;
    addToast(`Deleted ${name}`, 'success');
    push('/equipment');
  }

  // ─── Accessories ──────────────────────────────────────────────────────────
  let newAccessoryName = $state('');
  let accessoryBusy = $state(false);

  // Confirmation for removal — tracks which accessory is pending.
  let pendingAccessoryRemoval = $state<{ id: string; name: string } | null>(null);
  let accessoryRemoveBusy = $state(false);

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

  async function confirmRemoveAccessory(): Promise<void> {
    if (!item || !pendingAccessoryRemoval) return;
    accessoryRemoveBusy = true;
    const result = await removeEquipmentAccessory(item.id, pendingAccessoryRemoval.id);
    accessoryRemoveBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to remove accessory.', 'error');
      return;
    }
    pendingAccessoryRemoval = null;
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

  // Confirmation for removal — tracks which rule is pending.
  let pendingRuleRemoval = $state<{ index: number; text: string } | null>(null);
  let ruleRemoveBusy = $state(false);

  async function confirmRemoveRule(): Promise<void> {
    if (!item || !pendingRuleRemoval) return;
    ruleRemoveBusy = true;
    const result = await removeEquipmentRule(item.id, pendingRuleRemoval.index);
    ruleRemoveBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to remove rule.', 'error');
      return;
    }
    pendingRuleRemoval = null;
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
    {#snippet titleSlot()}
      {#if editingNameActive}
        <input
          bind:this={nameInput}
          data-testid="equipment-detail-name-input"
          class="text-2xl font-semibold tracking-tight text-foreground bg-transparent border-b border-foreground/30 outline-none w-full min-w-0"
          value={editingName}
          oninput={(e) => (editingName = e.currentTarget.value)}
          disabled={nameBusy}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commitEditName();
            } else if (e.key === 'Escape') {
              editingNameActive = false;
            }
          }}
          onblur={() => {
            void commitEditName();
          }}
        />
      {:else}
        <div class="flex items-center gap-2 min-w-0">
          <h1 class="text-2xl font-semibold tracking-tight text-foreground truncate">
            {item.name}
          </h1>
          <button
            class="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            onclick={startEditName}
            aria-label="Edit name"
            type="button"
            data-testid="equipment-detail-edit-name-btn"
          >
            <Icon name="Pencil" size={14} />
          </button>
        </div>
      {/if}
    {/snippet}

    {#snippet actions()}
      <Button
        data-testid="equipment-detail-delete-button"
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

    <div class="flex flex-col gap-8">
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
                  onclick={() => (pendingAccessoryRemoval = { id: acc.id, name: acc.name })}
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
                      onclick={() => (pendingRuleRemoval = { index: idx, text: rule })}
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

<!-- Delete equipment confirm dialog -->
<Dialog
  bind:open={deleteOpen}
  onOpenChange={(v) => {
    if (!v) deleteBusy = false;
  }}
>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="equipment-detail-delete-dialog">
      <DialogHeader>
        <DialogTitle>Delete "{item?.name ?? ''}"?</DialogTitle>
        <DialogDescription>This action cannot be undone.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" onclick={() => (deleteOpen = false)} disabled={deleteBusy}>
          Cancel
        </Button>
        <Button
          data-testid="equipment-detail-delete-confirm"
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

<!-- Remove rule confirm dialog -->
<Dialog
  open={pendingRuleRemoval !== null}
  onOpenChange={(v) => {
    if (!v) {
      pendingRuleRemoval = null;
      ruleRemoveBusy = false;
    }
  }}
>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="equipment-detail-remove-rule-dialog">
      <DialogHeader>
        <DialogTitle>Remove this rule?</DialogTitle>
        <DialogDescription>
          "{pendingRuleRemoval?.text ?? ''}"
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant="outline"
          onclick={() => (pendingRuleRemoval = null)}
          disabled={ruleRemoveBusy}
        >
          Cancel
        </Button>
        <Button
          data-testid="equipment-detail-remove-rule-confirm"
          variant="destructive"
          onclick={confirmRemoveRule}
          loading={ruleRemoveBusy}
          disabled={ruleRemoveBusy}
        >
          Remove
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>

<!-- Remove accessory confirm dialog -->
<Dialog
  open={pendingAccessoryRemoval !== null}
  onOpenChange={(v) => {
    if (!v) {
      pendingAccessoryRemoval = null;
      accessoryRemoveBusy = false;
    }
  }}
>
  <DialogContent>
    <div class="flex flex-col gap-4" data-testid="equipment-detail-remove-accessory-dialog">
      <DialogHeader>
        <DialogTitle>Remove "{pendingAccessoryRemoval?.name ?? ''}"?</DialogTitle>
        <DialogDescription>This accessory will be removed from this equipment.</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant="outline"
          onclick={() => (pendingAccessoryRemoval = null)}
          disabled={accessoryRemoveBusy}
        >
          Cancel
        </Button>
        <Button
          data-testid="equipment-detail-remove-accessory-confirm"
          variant="destructive"
          onclick={confirmRemoveAccessory}
          loading={accessoryRemoveBusy}
          disabled={accessoryRemoveBusy}
        >
          Remove
        </Button>
      </DialogFooter>
    </div>
  </DialogContent>
</Dialog>
