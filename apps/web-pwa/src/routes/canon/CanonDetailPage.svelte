<script lang="ts">
  import { push } from 'svelte-spa-router';
  import {
    Button,
    CanonIcon,
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
    RadioGroup,
    RadioGroupItem,
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
    updateCanonItemShoppingBehavior,
    updateCanonItemThreshold,
    approveCanonItemWithOverrides,
    deleteCanonItem,
    splitMostRecentSynonym,
    regenerateCanonIcon,
    hideCanonIcon,
    unhideCanonIcon,
  } from '../../lib/canonService.js';
  import { aisles } from '../../lib/aisleService.js';
  import { addToast } from '../../lib/toastStore.js';
  import { titleCase } from '../../lib/titleCase.js';
  import { CANON_ICON_HIDDEN } from '@salt/domain';
  import type { ShoppingBehavior, CanonItemUnit } from '@salt/shared-types';
  import AdminGuard from '../admin/AdminGuard.svelte';

  let { params }: { params: Record<string, string> } = $props();

  let item = $derived($canonItems.find((c) => c.id === params.id));

  let _initedId = $state('');

  // Name editing
  let editingName = $state('');
  let editingNameActive = $state(false);
  let nameInput = $state<HTMLInputElement | undefined>(undefined);
  let nameBusy = $state(false);
  let nameError = $state('');

  // Synonyms editing
  let editingSynonyms = $state('');
  let synonymsBusy = $state(false);
  let synonymsError = $state('');

  // Threshold + unit editing
  let editingThreshold = $state('');
  let editingUnit = $state<CanonItemUnit>('g');
  let thresholdBusy = $state(false);

  // Shopping behavior for approved items
  let behaviorBusy = $state(false);

  $effect(() => {
    const current = item;
    if (current && current.id !== _initedId) {
      _initedId = current.id;
      editingName = current.name;
      editingSynonyms = current.synonyms.join(', ');
      editingThreshold = current.largeQuantityThreshold?.toString() ?? '';
      editingUnit = current.unit ?? 'g';
    }
  });

  $effect(() => {
    if (editingNameActive && nameInput) {
      nameInput.focus();
      nameInput.select();
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
    if (
      synonyms.length === item.synonyms.length &&
      synonyms.every((s, i) => s === item.synonyms[i])
    )
      return;
    synonymsBusy = true;
    synonymsError = '';
    const result = await updateCanonItemSynonyms(item, synonyms);
    synonymsBusy = false;
    if (result.kind !== 'ok') {
      synonymsError = 'Invalid synonyms.';
    }
  }

  async function saveShoppingBehavior(value: string): Promise<void> {
    if (!item || item.needs_approval) return;
    const behavior = value as ShoppingBehavior;
    if (behavior === item.shoppingBehavior) return;
    behaviorBusy = true;
    await updateCanonItemShoppingBehavior(item, behavior);
    behaviorBusy = false;
  }

  async function saveThreshold(): Promise<void> {
    if (!item || item.needs_approval) return;
    const raw = editingThreshold.trim();
    const parsed = raw ? parseFloat(raw) : undefined;
    const validParsed = parsed !== undefined && !isNaN(parsed) ? parsed : undefined;
    const unit = validParsed !== undefined ? editingUnit : undefined;
    thresholdBusy = true;
    await updateCanonItemThreshold(item, validParsed, unit);
    thresholdBusy = false;
  }

  // Approval
  let pendingBehavior = $state<ShoppingBehavior>('needed');
  let approveBusy = $state(false);

  $effect(() => {
    const current = item;
    if (current?.needs_approval) pendingBehavior = current.shoppingBehavior;
  });

  async function handleApprove(): Promise<void> {
    if (!item) return;
    approveBusy = true;
    const raw = editingThreshold.trim();
    const parsed = raw ? parseFloat(raw) : undefined;
    const validParsed = parsed !== undefined && !isNaN(parsed) ? parsed : undefined;
    await approveCanonItemWithOverrides(item, {
      shoppingBehavior: pendingBehavior,
      ...(validParsed !== undefined
        ? { largeQuantityThreshold: validParsed, unit: editingUnit }
        : {}),
    });
    approveBusy = false;
    push('/admin/canon');
  }

  const aisleItems = $derived([
    { value: '', label: 'No aisle' },
    ...$aisles.map((a) => ({ value: a.id, label: titleCase(a.name) })),
  ]);

  // Split (most recent synonym → new canon item)
  let splitBusy = $state(false);

  async function handleSplit(): Promise<void> {
    if (!item || item.synonyms.length === 0) return;
    splitBusy = true;
    const last = item.synonyms[item.synonyms.length - 1]!;
    const result = await splitMostRecentSynonym(item);
    splitBusy = false;
    if (result.kind === 'ok') {
      addToast(`Split "${titleCase(last)}" into a new item`, 'success');
      push(`/admin/canon/${result.value.id}`);
    }
  }

  // Icon (Tier-1 pictogram) escape hatch
  let iconBusy = $state(false);
  const iconHidden = $derived(item?.thumbnail === CANON_ICON_HIDDEN);

  // Regenerate dialog — optional one-shot steer added to the generation prompt.
  let regenerateOpen = $state(false);
  let regenerateHint = $state('');

  function openRegenerateDialog(): void {
    regenerateHint = '';
    regenerateOpen = true;
  }

  async function handleRegenerateIcon(): Promise<void> {
    if (!item) return;
    const hint = regenerateHint.trim();
    iconBusy = true;
    const result = await regenerateCanonIcon(item.id, hint || undefined);
    iconBusy = false;
    regenerateOpen = false;
    if (result.kind === 'ok') addToast('Regenerating icon…', 'success');
    else addToast('Failed to regenerate icon.', 'destructive');
  }

  async function handleHideIcon(): Promise<void> {
    if (!item) return;
    iconBusy = true;
    const result = await hideCanonIcon(item);
    iconBusy = false;
    if (result.kind !== 'ok') addToast('Failed to hide icon.', 'destructive');
  }

  async function handleUnhideIcon(): Promise<void> {
    if (!item) return;
    iconBusy = true;
    const result = await unhideCanonIcon(item.id);
    iconBusy = false;
    if (result.kind !== 'ok') addToast('Failed to unhide icon.', 'destructive');
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
      push('/admin/canon');
    }
  }
</script>

<AdminGuard>
  <div class="p-4 sm:p-6">
    {#if !item}
      <div class="flex flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" onclick={() => push('/admin/canon')}>
            {#snippet leading()}
              <Icon name="ArrowLeft" size={16} />
            {/snippet}
            Items
          </Button>
        </div>
        <Text muted>Item not found.</Text>
      </div>
    {:else}
      <DetailPage
        title={titleCase(item.name)}
        onBack={() => push('/admin/canon')}
        backLabel="Items"
      >
        {#snippet titleSlot()}
          {#if editingNameActive}
            <input
              bind:this={nameInput}
              data-testid="canon-detail-name-input"
              class="text-2xl font-semibold tracking-tight text-foreground bg-transparent border-b border-foreground/30 outline-none w-full min-w-0"
              value={editingName}
              oninput={(e) => (editingName = e.currentTarget.value)}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  saveName();
                  editingNameActive = false;
                } else if (e.key === 'Escape') {
                  editingName = item!.name;
                  editingNameActive = false;
                }
              }}
              onblur={() => {
                editingName = item!.name;
                editingNameActive = false;
              }}
            />
          {:else}
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h1 class="text-2xl font-semibold tracking-tight text-foreground truncate">
                  {titleCase(item.name)}
                </h1>
                <button
                  class="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  onclick={() => {
                    editingName = item!.name;
                    editingNameActive = true;
                    nameError = '';
                  }}
                  aria-label="Edit name"
                  type="button"
                >
                  <Icon name="Pencil" size={14} />
                </button>
              </div>
              {#if nameError}
                <span class="text-sm text-destructive">{nameError}</span>
              {/if}
            </div>
          {/if}
        {/snippet}

        {#snippet actions()}
          {#if item.synonyms.length > 0}
            <Button
              data-testid="canon-detail-split-button"
              variant="outline"
              size="sm"
              onclick={handleSplit}
              loading={splitBusy}
              disabled={splitBusy}
            >
              {#snippet leading()}
                <Icon name="Split" size={16} />
              {/snippet}
              Split
            </Button>
          {/if}
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
          <!-- Icon (Tier-1 pictogram) -->
          <section class="flex flex-col gap-2" data-testid="canon-detail-icon-section">
            <h2 class="text-sm font-medium text-foreground">Icon</h2>
            <div class="flex items-center gap-3">
              <CanonIcon
                thumbnail={item.thumbnail}
                name={item.name}
                size={96}
                version={item.iconRequestedAt ?? item.updatedAt}
              />
              <div class="flex gap-2">
                <Button
                  data-testid="canon-detail-icon-regenerate"
                  variant="outline"
                  size="sm"
                  onclick={openRegenerateDialog}
                  disabled={iconBusy}
                >
                  {#snippet leading()}
                    <Icon name="RefreshCw" size={16} />
                  {/snippet}
                  Regenerate
                </Button>
                {#if iconHidden}
                  <Button
                    data-testid="canon-detail-icon-unhide"
                    variant="outline"
                    size="sm"
                    onclick={handleUnhideIcon}
                    loading={iconBusy}
                    disabled={iconBusy}
                  >
                    {#snippet leading()}
                      <Icon name="Eye" size={16} />
                    {/snippet}
                    Unhide
                  </Button>
                {:else}
                  <Button
                    data-testid="canon-detail-icon-hide"
                    variant="outline"
                    size="sm"
                    onclick={handleHideIcon}
                    loading={iconBusy}
                    disabled={iconBusy}
                  >
                    {#snippet leading()}
                      <Icon name="EyeOff" size={16} />
                    {/snippet}
                    Hide
                  </Button>
                {/if}
              </div>
            </div>
          </section>

          <!-- Approval — all AI-assigned fields -->
          {#if item.needs_approval}
            <section
              class="flex flex-col gap-4 rounded border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30"
              data-testid="canon-detail-approval-section"
            >
              <h2 class="text-sm font-semibold text-amber-800 dark:text-amber-300">
                Review before approving
              </h2>

              {#if item.reasoning}
                <p
                  class="text-sm text-amber-900 dark:text-amber-200"
                  data-testid="canon-detail-reasoning"
                >
                  {item.reasoning}
                </p>
              {/if}

              <!-- Aisle -->
              <div class="flex flex-col gap-1.5">
                <span class="text-sm font-medium text-foreground">Aisle</span>
                <div class="flex items-center gap-2">
                  <div class="flex-1" data-testid="canon-detail-aisle-select">
                    <Combobox
                      items={aisleItems}
                      value={item.aisleId ?? ''}
                      onValueChange={saveAisle}
                      placeholder="Search aisles…"
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
                            <ComboboxEmpty>No aisles match.</ComboboxEmpty>
                          {/if}
                        {/snippet}
                      </ComboboxContent>
                    </Combobox>
                  </div>
                  {#if aisleBusy}
                    <Spinner size={16} />
                  {/if}
                </div>
              </div>

              <!-- Synonyms -->
              <TextField
                label="Synonyms"
                description="Separate multiple synonyms with commas."
                value={editingSynonyms}
                onValueChange={(v) => (editingSynonyms = v)}
                error={synonymsError}
                placeholder="e.g. Butter, Unsalted butter"
                data-testid="canon-detail-synonyms-input"
                disabled={synonymsBusy}
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveSynonyms();
                  }
                }}
                onblur={saveSynonyms}
              />

              <!-- Shopping behavior -->
              <RadioGroup
                label="Shopping behavior"
                orientation="horizontal"
                value={pendingBehavior}
                onValueChange={(v) => (pendingBehavior = v as ShoppingBehavior)}
              >
                <RadioGroupItem value="stocked" label="Stocked" />
                <RadioGroupItem value="check" label="Check" />
                <RadioGroupItem value="needed" label="Needed" />
              </RadioGroup>

              <!-- Threshold + unit -->
              <div class="flex gap-2 items-end">
                <div class="flex-1">
                  <TextField
                    label="Quantity threshold (optional)"
                    inputmode="numeric"
                    value={editingThreshold}
                    onValueChange={(v) => (editingThreshold = v)}
                    placeholder="e.g. 500"
                    data-testid="canon-detail-threshold-input"
                  />
                </div>
                <div class="w-28">
                  <Select
                    value={editingUnit}
                    onValueChange={(v) => (editingUnit = v as CanonItemUnit)}
                  >
                    <SelectTrigger data-testid="canon-detail-unit-select"
                      >{editingUnit}</SelectTrigger
                    >
                    <SelectContent>
                      <SelectItem value="g">g</SelectItem>
                      <SelectItem value="ml">ml</SelectItem>
                      <SelectItem value="count">count</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Button
                  data-testid="canon-detail-approve-button"
                  onclick={handleApprove}
                  loading={approveBusy}
                  disabled={approveBusy}
                >
                  Approve
                </Button>
              </div>
            </section>
          {/if}

          <!-- Shopping behavior (approved only) -->
          {#if !item.needs_approval}
            <section class="flex flex-col gap-2" data-testid="canon-detail-behavior-section">
              <div class="flex items-center gap-2">
                <RadioGroup
                  label="Shopping behavior"
                  orientation="horizontal"
                  value={item.shoppingBehavior}
                  onValueChange={saveShoppingBehavior}
                  disabled={behaviorBusy}
                >
                  <RadioGroupItem value="stocked" label="Stocked" />
                  <RadioGroupItem value="check" label="Check" />
                  <RadioGroupItem value="needed" label="Needed" />
                </RadioGroup>
                {#if behaviorBusy}
                  <Spinner size={16} />
                {/if}
              </div>
            </section>
          {/if}

          <!-- Quantity threshold (approved only) -->
          {#if !item.needs_approval}
            <section class="flex flex-col gap-2" data-testid="canon-detail-threshold-section">
              <h2 class="text-sm font-medium text-foreground">Quantity threshold</h2>
              <div class="flex gap-2 items-end">
                <div class="flex-1">
                  <TextField
                    label=""
                    inputmode="numeric"
                    value={editingThreshold}
                    onValueChange={(v) => (editingThreshold = v)}
                    placeholder="e.g. 500"
                    data-testid="canon-detail-threshold-input"
                  />
                </div>
                <div class="w-28">
                  <Select
                    value={editingUnit}
                    onValueChange={(v) => (editingUnit = v as CanonItemUnit)}
                    disabled={thresholdBusy}
                  >
                    <SelectTrigger data-testid="canon-detail-unit-select"
                      >{editingUnit}</SelectTrigger
                    >
                    <SelectContent>
                      <SelectItem value="g">g</SelectItem>
                      <SelectItem value="ml">ml</SelectItem>
                      <SelectItem value="count">count</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  data-testid="canon-detail-threshold-save"
                  variant="outline"
                  onclick={saveThreshold}
                  loading={thresholdBusy}
                  disabled={thresholdBusy}
                >
                  Save
                </Button>
              </div>
            </section>
          {/if}

          <!-- Aisle (approved only) -->
          {#if !item.needs_approval}
            <section class="flex flex-col gap-2">
              <h2 class="text-sm font-medium text-foreground">Aisle</h2>
              <div class="flex items-center gap-2">
                <div class="flex-1" data-testid="canon-detail-aisle-select">
                  <Combobox
                    items={aisleItems}
                    value={item.aisleId ?? ''}
                    onValueChange={saveAisle}
                    placeholder="Search aisles…"
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
                          <ComboboxEmpty>No aisles match.</ComboboxEmpty>
                        {/if}
                      {/snippet}
                    </ComboboxContent>
                  </Combobox>
                </div>
                {#if aisleBusy}
                  <Spinner size={16} />
                {/if}
              </div>
            </section>
          {/if}

          <!-- Synonyms (approved only) -->
          {#if !item.needs_approval}
            <section class="flex flex-col gap-2">
              <TextField
                label="Synonyms"
                description="Separate multiple synonyms with commas."
                value={editingSynonyms}
                onValueChange={(v) => (editingSynonyms = v)}
                error={synonymsError}
                placeholder="e.g. Butter, Unsalted butter"
                data-testid="canon-detail-synonyms-input"
                disabled={synonymsBusy}
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveSynonyms();
                  }
                }}
                onblur={saveSynonyms}
              />
            </section>
          {/if}
        </div>
      </DetailPage>
    {/if}
  </div>

  <!-- Regenerate icon dialog — optional additive prompt steer -->
  <Dialog bind:open={regenerateOpen}>
    <DialogContent>
      <div class="flex flex-col gap-4" data-testid="canon-detail-regenerate-dialog">
        <DialogHeader>
          <DialogTitle>Regenerate icon</DialogTitle>
          <DialogDescription>
            Optionally add guidance for the new icon. Leave blank to just try again.
          </DialogDescription>
        </DialogHeader>
        <TextField
          label="Extra guidance (optional)"
          value={regenerateHint}
          onValueChange={(v) => (regenerateHint = v)}
          placeholder="e.g. show it as a tin, sliced, make it greener"
          data-testid="canon-detail-regenerate-hint"
          disabled={iconBusy}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleRegenerateIcon();
            }
          }}
        />
        <DialogFooter>
          <Button variant="outline" onclick={() => (regenerateOpen = false)} disabled={iconBusy}>
            Cancel
          </Button>
          <Button
            data-testid="canon-detail-regenerate-confirm"
            onclick={handleRegenerateIcon}
            loading={iconBusy}
            disabled={iconBusy}
          >
            Regenerate
          </Button>
        </DialogFooter>
      </div>
    </DialogContent>
  </Dialog>

  <!-- Delete confirm dialog -->
  <Dialog
    bind:open={deleteOpen}
    onOpenChange={(v) => {
      if (!v) deleteBusy = false;
    }}
  >
    <DialogContent>
      <div class="flex flex-col gap-4" data-testid="canon-detail-delete-dialog">
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
</AdminGuard>
