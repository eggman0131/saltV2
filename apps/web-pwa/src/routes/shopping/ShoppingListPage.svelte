<script lang="ts">
  import {
    Button,
    Checkbox,
    Combobox,
    ComboboxContent,
    ComboboxCreate,
    ComboboxEmpty,
    ComboboxField,
    ComboboxInput,
    ComboboxItem,
    Icon,
    ListPage,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    Sheet,
    SheetContent,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    Spinner,
    TextArea,
    TextField,
    EmptyState,
  } from '@salt/ui-components';
  import { titleCase } from '../../lib/titleCase.js';
  import { push } from 'svelte-spa-router';
  import { groupItemsByAisle } from '@salt/domain';
  import type { ShoppingListItem } from '@salt/domain';
  import { canonItems, aisles } from '../../lib/canonService.js';
  import {
    lists,
    defaultListId,
    itemsForActiveList,
    isLoadingShoppingList,
    setActiveListId,
    addItemToList,
    updateItemRawText,
    updateItemAmountUnit,
    updateItemNotes,
    toggleItemChecked,
    checkItems,
    uncheckItems,
    removeItem,
    removeItems,
    clearChecked,
    moveSelectedItems,
  } from '../../lib/shoppingListService.svelte.js';
  import { addToast } from '../../lib/toastStore.js';

  interface Props {
    params: { listId: string };
  }
  let { params }: Props = $props();

  // ─── Subscribe to items for this list ────────────────────────────────────────

  $effect(() => {
    setActiveListId(params.listId);
  });

  // ─── Derived state ────────────────────────────────────────────────────────────

  const currentList = $derived($lists.find((l) => l.id === params.listId) ?? null);
  const otherLists = $derived($lists.filter((l) => l.id !== params.listId));
  const isDefault = $derived($defaultListId === params.listId);

  const canonMap = $derived(
    new Map($canonItems.map((ci) => [ci.id, { id: ci.id, name: ci.name, aisleId: ci.aisleId }])),
  );

  const aisleInfos = $derived($aisles.map((a) => ({ id: a.id, name: a.name, order: a.order })));

  const grouped = $derived(groupItemsByAisle($itemsForActiveList, canonMap, aisleInfos));

  const hasCheckedItems = $derived($itemsForActiveList.some((i) => i.checked));

  const allItemIds = $derived($itemsForActiveList.map((i) => i.id));
  const totalItems = $derived(
    grouped.other.contributors.length +
      grouped.checked.contributors.length +
      grouped.aisles.reduce((sum, ag) => sum + ag.items.length, 0),
  );

  const isEmpty = $derived(!$isLoadingShoppingList && totalItems === 0);

  // ─── Selection state ──────────────────────────────────────────────────────────

  let selectionMode = $state(false);

  let selected = $state(new Set<string>());

  $effect(() => {
    if (!selectionMode) selected = new Set();
  });

  const selectedCount = $derived(allItemIds.filter((id) => selected.has(id)).length);
  const allSelected = $derived(allItemIds.length > 0 && allItemIds.every((id) => selected.has(id)));
  const someSelected = $derived(allItemIds.some((id) => selected.has(id)) && !allSelected);

  function toggleSelection(id: string): void {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function toggleAll(): void {
    selected = allSelected ? new Set() : new Set(allItemIds);
  }

  // ─── Item capture ─────────────────────────────────────────────────────────────

  let newItemText = $state('');
  let addBusy = $state(false);
  let comboboxResetKey = $state(0);

  const comboItems = $derived($canonItems.map((c) => ({ value: c.id, label: titleCase(c.name) })));

  function filterFn(input: string, comboItem: { value: string; label: string }): boolean {
    const q = input.trim().toLowerCase();
    if (!q) return true;
    const canon = $canonItems.find((c) => c.id === comboItem.value);
    return (
      comboItem.label.toLowerCase().includes(q) ||
      (canon?.synonyms.some((s) => s.toLowerCase().includes(q)) ?? false)
    );
  }

  async function handleAddItem(): Promise<void> {
    const text = newItemText.trim();
    if (!text) return;
    addBusy = true;
    const result = await addItemToList(params.listId, text);
    addBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to add item.', 'error');
    } else if (newItemText.trim() === text) {
      newItemText = '';
      comboboxResetKey++;
    }
  }

  function handleComboboxValueChange(id: string): void {
    const item = $canonItems.find((c) => c.id === id);
    if (!item) return;
    newItemText = item.name;
    void handleAddItem();
  }

  function handleComboboxCreate(text: string): void {
    newItemText = text;
    void handleAddItem();
  }

  // ─── Edit sheet ───────────────────────────────────────────────────────────────

  let editSheetOpen = $state(false);
  let editingItem = $state<ShoppingListItem | null>(null);
  let editRawText = $state('');
  let editAmount = $state('');
  let editUnit = $state('');
  let editNotes = $state('');
  let editBusy = $state(false);
  let editDeleteBusy = $state(false);

  function openEditSheet(item: ShoppingListItem): void {
    editingItem = item;
    editRawText = item.rawText;
    editAmount = item.amount !== undefined ? String(item.amount) : '';
    editUnit = item.unit ?? '';
    editNotes = item.notes;
    editSheetOpen = true;
  }

  async function handleEditSave(): Promise<void> {
    if (!editingItem) return;
    editBusy = true;
    const rawChanged = editRawText.trim() !== editingItem.rawText;
    const notesChanged = editNotes.trim() !== editingItem.notes;
    const parsedAmount = editAmount.trim() ? parseFloat(editAmount.trim()) : undefined;
    const parsedUnit = editUnit.trim() || undefined;
    const amountUnitChanged =
      parsedAmount !== editingItem.amount || parsedUnit !== editingItem.unit;
    if (rawChanged) {
      const r = await updateItemRawText(params.listId, editingItem.id, editRawText);
      if (r.kind !== 'ok') {
        addToast('Failed to update item.', 'error');
        editBusy = false;
        return;
      }
    }
    if (amountUnitChanged) {
      const r = await updateItemAmountUnit(
        params.listId,
        editingItem.id,
        Number.isNaN(parsedAmount) ? undefined : parsedAmount,
        parsedUnit,
      );
      if (r.kind !== 'ok') {
        addToast('Failed to update quantity.', 'error');
        editBusy = false;
        return;
      }
    }
    if (notesChanged) {
      const r = await updateItemNotes(params.listId, editingItem.id, editNotes);
      if (r.kind !== 'ok') {
        addToast('Failed to update notes.', 'error');
        editBusy = false;
        return;
      }
    }
    editBusy = false;
    editSheetOpen = false;
  }

  async function handleEditDelete(): Promise<void> {
    if (!editingItem) return;
    editDeleteBusy = true;
    const result = await removeItem(params.listId, editingItem.id);
    editDeleteBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to delete item.', 'error');
    } else {
      editSheetOpen = false;
    }
  }

  // ─── Bulk actions ─────────────────────────────────────────────────────────────

  let bulkBusy = $state(false);
  let moveTargetListId = $state('');

  async function handleBulkDelete(): Promise<void> {
    if (selectedCount === 0) return;
    bulkBusy = true;
    const ids = [...selected];
    const result = await removeItems(params.listId, ids);
    bulkBusy = false;
    selected = new Set();
    if (result.kind !== 'ok') addToast('Failed to delete items.', 'error');
  }

  async function handleBulkCheck(): Promise<void> {
    if (selectedCount === 0) return;
    bulkBusy = true;
    await checkItems(params.listId, [...selected]);
    bulkBusy = false;
    selected = new Set();
  }

  async function handleBulkUncheck(): Promise<void> {
    if (selectedCount === 0) return;
    bulkBusy = true;
    await uncheckItems(params.listId, [...selected]);
    bulkBusy = false;
    selected = new Set();
  }

  async function handleBulkMove(): Promise<void> {
    if (selectedCount === 0 || !moveTargetListId) return;
    bulkBusy = true;
    const ids = [...selected];
    const result = await moveSelectedItems(params.listId, moveTargetListId, ids);
    bulkBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to move items.', 'error');
    } else {
      selected = new Set();
      moveTargetListId = '';
    }
  }

  async function handleClearChecked(): Promise<void> {
    const result = await clearChecked(params.listId);
    if (result.kind !== 'ok') addToast('Failed to clear checked items.', 'error');
  }

  // ─── Item row helper ──────────────────────────────────────────────────────────

  function toSentenceCase(text: string): string {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function sourceLabel(item: ShoppingListItem): string {
    const src = item.sources[0];
    if (!src || src.kind === 'manual') return '';
    if (src.kind === 'recipe') return src.label ?? 'Recipe';
    return '';
  }

  function formatAmount(amount: number | undefined, unit: string | undefined): string | null {
    if (amount === undefined) return null;
    return unit ? `${amount} ${unit}` : `${amount}`;
  }
</script>

{#if !$isLoadingShoppingList && currentList === null}
  <div class="p-4 sm:p-6 flex flex-col gap-3">
    <p class="text-sm text-muted-foreground">List not found.</p>
    <Button variant="outline" onclick={() => push('/shopping')}>Go to shopping</Button>
  </div>
{:else}
  <ListPage
    title={currentList?.name ?? 'Shopping list'}
    isLoading={$isLoadingShoppingList}
    {isEmpty}
    bind:selectionMode
    class="p-4 sm:p-6"
    data-testid="shopping-list-page"
  >
    {#snippet actions()}
      {#if $lists.length > 1}
        <Select value={params.listId} onValueChange={(id) => push(`/shopping/${id}`)}>
          <SelectTrigger class="text-sm h-8 min-w-[8rem]" data-testid="shopping-list-picker" />
          <SelectContent>
            {#each $lists as list (list.id)}
              <SelectItem value={list.id}>{list.name}</SelectItem>
            {/each}
          </SelectContent>
        </Select>
      {/if}
      {#if hasCheckedItems}
        <Button
          variant="outline"
          size="sm"
          onclick={handleClearChecked}
          data-testid="shopping-clear-checked"
        >
          Clear checked
        </Button>
      {/if}
      <Button
        variant="ghost"
        size="sm"
        onclick={() => push(`/shopping/${params.listId}/manage`)}
        data-testid="shopping-manage-list"
      >
        <Icon name="Settings" size={14} />
      </Button>
      <Button size="sm" onclick={() => push('/shopping/new')} data-testid="shopping-add-list">
        + List
      </Button>
    {/snippet}

    {#snippet toolbar()}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="flex-1"
        oninput={(e) => {
          newItemText = (e.target as HTMLInputElement).value;
        }}
      >
        {#key comboboxResetKey}
          <Combobox
            items={comboItems}
            allowCustom={true}
            {filterFn}
            onValueChange={handleComboboxValueChange}
            onCreate={handleComboboxCreate}
            placeholder="Add an item…"
          >
            <ComboboxField class="w-full">
              <ComboboxInput data-testid="shopping-item-input" />
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
                  <ComboboxEmpty>No matches</ComboboxEmpty>
                {/if}
              {/snippet}
            </ComboboxContent>
          </Combobox>
        {/key}
      </div>
      <Button
        onclick={handleAddItem}
        loading={addBusy}
        disabled={!newItemText.trim() || addBusy}
        data-testid="shopping-item-add-btn"
      >
        Add
      </Button>
    {/snippet}

    {#snippet selectionBar()}
      <Checkbox
        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
        onCheckedChange={toggleAll}
        label={selectedCount > 0 ? `${selectedCount} selected` : 'Select all'}
      />
      {#if selectedCount > 0}
        <div class="flex items-center gap-1 flex-wrap">
          <Button
            variant="destructive"
            size="sm"
            onclick={handleBulkDelete}
            loading={bulkBusy}
            disabled={bulkBusy}
            data-testid="shopping-bulk-delete"
          >
            Delete
          </Button>
          <Button
            variant="outline"
            size="sm"
            onclick={handleBulkCheck}
            loading={bulkBusy}
            disabled={bulkBusy}
          >
            Check
          </Button>
          <Button
            variant="outline"
            size="sm"
            onclick={handleBulkUncheck}
            loading={bulkBusy}
            disabled={bulkBusy}
          >
            Uncheck
          </Button>
          {#if otherLists.length > 0}
            <Select
              value={moveTargetListId}
              onValueChange={(id) => {
                moveTargetListId = id;
              }}
            >
              <SelectTrigger class="text-sm h-8" data-testid="shopping-bulk-move-select">
                Move to…
              </SelectTrigger>
              <SelectContent>
                {#each otherLists as list (list.id)}
                  <SelectItem value={list.id}>{list.name}</SelectItem>
                {/each}
              </SelectContent>
            </Select>
            {#if moveTargetListId}
              <Button
                variant="outline"
                size="sm"
                onclick={handleBulkMove}
                loading={bulkBusy}
                disabled={bulkBusy}
                data-testid="shopping-bulk-move-confirm"
              >
                Move
              </Button>
            {/if}
          {/if}
          <Button
            variant="ghost"
            size="sm"
            onclick={() => (selected = new Set())}
            disabled={bulkBusy}
          >
            Clear
          </Button>
        </div>
      {/if}
    {/snippet}

    {#snippet empty()}
      <EmptyState title="Your list is empty" description="Add items above to get started." />
    {/snippet}

    {#snippet children()}
      <div class="flex flex-col gap-4" data-testid="shopping-list-content">
        <!-- Aisle groups -->
        {#each grouped.aisles as aisleGroup (aisleGroup.aisleId)}
          <section
            class="flex flex-col gap-1"
            data-testid="shopping-aisle-group"
            data-aisle-id={aisleGroup.aisleId}
          >
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              {aisleGroup.aisleName}
            </p>

            {#each aisleGroup.items as item (item.id)}
              {@const isSelected = selected.has(item.id)}
              {@const amountStr = formatAmount(item.amount, item.unit)}
              <div
                class="flex items-center gap-3 rounded border px-3 py-2 text-sm {isSelected
                  ? 'border-ring ring-2 ring-ring bg-card'
                  : 'border-border bg-card'}"
                data-testid="shopping-item-row"
                data-item-id={item.id}
              >
                {#if selectionMode}
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleSelection(item.id)}
                    label=""
                    aria-label="Select {item.rawText}"
                  />
                {/if}
                <button
                  type="button"
                  class="flex-1 min-w-0 text-left"
                  onclick={() => openEditSheet(item)}
                  aria-label="Edit {item.rawText}"
                  data-testid="shopping-item-edit-btn"
                >
                  <span class="block truncate">
                    {toSentenceCase(item.rawText)}{#if amountStr}{' '}<span
                        class="text-muted-foreground">({amountStr})</span
                      >{/if}
                  </span>
                  {#if item.notes}
                    <span class="block text-xs text-muted-foreground truncate"
                      >{toSentenceCase(item.notes)}</span
                    >
                  {/if}
                  {#if sourceLabel(item)}
                    <span class="block text-xs text-muted-foreground/70">{sourceLabel(item)}</span>
                  {/if}
                </button>
                <button
                  type="button"
                  class="flex items-center justify-center p-1 rounded transition-colors {item.checked
                    ? 'text-green-500'
                    : 'text-muted-foreground hover:text-foreground'}"
                  onclick={() => void toggleItemChecked(params.listId, item)}
                  aria-label={item.checked ? 'Uncheck' : 'Mark as done'}
                  data-testid="shopping-item-check"
                >
                  <Icon name={item.checked ? 'CircleCheck' : 'Circle'} size={18} />
                </button>
              </div>
            {/each}
          </section>
        {/each}

        <!-- Other (pending / failed / no-aisle items) -->
        {#if grouped.other.contributors.length > 0}
          <section class="flex flex-col gap-1" data-testid="shopping-other">
            <div class="flex items-center gap-2 mb-1">
              <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Other
              </p>
              {#if grouped.other.contributors.some((c) => c.isPending)}
                <Spinner size={12} />
              {/if}
            </div>
            {#each grouped.other.contributors as { item, isPending } (item.id)}
              {@const isSelected = selected.has(item.id)}
              {@const amountStr = formatAmount(item.amount, item.unit)}
              <div
                class="flex items-center gap-3 rounded border px-3 py-2 text-sm {isSelected
                  ? 'border-ring ring-2 ring-ring bg-card'
                  : 'border-border bg-card'}"
                data-testid="shopping-item-row"
                data-item-id={item.id}
              >
                {#if selectionMode}
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleSelection(item.id)}
                    label=""
                    aria-label="Select {item.rawText}"
                  />
                {/if}
                <button
                  type="button"
                  class="flex-1 min-w-0 text-left"
                  onclick={() => openEditSheet(item)}
                  aria-label="Edit {item.rawText}"
                  data-testid="shopping-item-edit-btn"
                >
                  <span
                    class="block truncate {item.checked
                      ? 'line-through text-muted-foreground'
                      : ''}"
                  >
                    {toSentenceCase(item.rawText)}{#if amountStr}{' '}<span
                        class="text-muted-foreground">({amountStr})</span
                      >{/if}
                  </span>
                  {#if item.notes}
                    <span class="block text-xs text-muted-foreground truncate"
                      >{toSentenceCase(item.notes)}</span
                    >
                  {/if}
                </button>
                {#if isPending}
                  <Spinner size={14} />
                {/if}
                <button
                  type="button"
                  class="flex items-center justify-center p-1 rounded transition-colors {item.checked
                    ? 'text-green-500'
                    : 'text-muted-foreground hover:text-foreground'}"
                  onclick={() => void toggleItemChecked(params.listId, item)}
                  aria-label={item.checked ? 'Uncheck' : 'Mark as done'}
                  data-testid="shopping-item-check"
                >
                  <Icon name={item.checked ? 'CircleCheck' : 'Circle'} size={18} />
                </button>
              </div>
            {/each}
          </section>
        {/if}

        <!-- Checked items -->
        {#if grouped.checked.contributors.length > 0}
          <section class="flex flex-col gap-1" data-testid="shopping-checked">
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              Checked
            </p>
            {#each grouped.checked.contributors as item (item.id)}
              {@const isSelected = selected.has(item.id)}
              {@const amountStr = formatAmount(item.amount, item.unit)}
              <div
                class="flex items-center gap-3 rounded border px-3 py-2 text-sm {isSelected
                  ? 'border-ring ring-2 ring-ring bg-card'
                  : 'border-border bg-card'}"
                data-testid="shopping-item-row"
                data-item-id={item.id}
              >
                {#if selectionMode}
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleSelection(item.id)}
                    label=""
                    aria-label="Select {item.rawText}"
                  />
                {/if}
                <button
                  type="button"
                  class="flex-1 min-w-0 text-left"
                  onclick={() => openEditSheet(item)}
                  aria-label="Edit {item.rawText}"
                  data-testid="shopping-item-edit-btn"
                >
                  <span class="block truncate line-through text-muted-foreground">
                    {toSentenceCase(item.rawText)}{#if amountStr}{' '}({amountStr}){/if}
                  </span>
                  {#if item.notes}
                    <span class="block text-xs text-muted-foreground/60 truncate"
                      >{toSentenceCase(item.notes)}</span
                    >
                  {/if}
                </button>
                <button
                  type="button"
                  class="flex items-center justify-center p-1 rounded transition-colors {item.checked
                    ? 'text-green-500'
                    : 'text-muted-foreground hover:text-foreground'}"
                  onclick={() => void toggleItemChecked(params.listId, item)}
                  aria-label={item.checked ? 'Uncheck' : 'Mark as done'}
                  data-testid="shopping-item-check"
                >
                  <Icon name={item.checked ? 'CircleCheck' : 'Circle'} size={18} />
                </button>
              </div>
            {/each}
          </section>
        {/if}
      </div>
    {/snippet}
  </ListPage>
{/if}

<!-- Edit item sheet -->
<Sheet
  bind:open={editSheetOpen}
  onOpenChange={(v) => {
    if (!v) {
      editingItem = null;
    }
  }}
>
  <SheetContent side="bottom" class="flex flex-col gap-4 p-4 pb-8">
    <SheetHeader>
      <SheetTitle>Edit item</SheetTitle>
    </SheetHeader>

    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium" for="edit-item-rawtext">Item</label>
        <TextField
          id="edit-item-rawtext"
          bind:value={editRawText}
          placeholder="What do you need?"
          disabled={editBusy}
          data-testid="shopping-edit-rawtext"
        />
      </div>
      <div class="flex gap-3">
        <div class="flex flex-col gap-1.5 w-24">
          <label class="text-sm font-medium" for="edit-item-amount">Quantity</label>
          <TextField
            id="edit-item-amount"
            bind:value={editAmount}
            placeholder="e.g. 2"
            inputmode="decimal"
            disabled={editBusy}
            data-testid="shopping-edit-amount"
          />
        </div>
        <div class="flex flex-col gap-1.5 flex-1">
          <label class="text-sm font-medium" for="edit-item-unit">Unit</label>
          <TextField
            id="edit-item-unit"
            bind:value={editUnit}
            placeholder="e.g. kg"
            disabled={editBusy}
            data-testid="shopping-edit-unit"
          />
        </div>
      </div>
      <div class="flex flex-col gap-1.5">
        <label class="text-sm font-medium" for="edit-item-notes">Notes</label>
        <TextArea
          id="edit-item-notes"
          bind:value={editNotes}
          placeholder="Any notes…"
          disabled={editBusy}
          rows={3}
          data-testid="shopping-edit-notes"
        />
      </div>
    </div>

    <SheetFooter class="flex justify-between">
      <Button
        variant="destructive"
        size="sm"
        onclick={handleEditDelete}
        loading={editDeleteBusy}
        disabled={editBusy || editDeleteBusy}
        data-testid="shopping-edit-delete"
      >
        Delete
      </Button>
      <div class="flex gap-2">
        <Button
          variant="ghost"
          size="sm"
          onclick={() => (editSheetOpen = false)}
          disabled={editBusy || editDeleteBusy}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          onclick={handleEditSave}
          loading={editBusy}
          disabled={editBusy || editDeleteBusy || !editRawText.trim()}
          data-testid="shopping-edit-save"
        >
          Save
        </Button>
      </div>
    </SheetFooter>
  </SheetContent>
</Sheet>
