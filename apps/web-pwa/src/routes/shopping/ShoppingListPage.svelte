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
    Popover,
    PopoverContent,
    PopoverTrigger,
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

  // ─── Deferred bulk delete ───────────────────────────────────────────────────────
  // Selected items are hidden immediately, but the real Firestore delete is only
  // committed once the undo window closes. Pressing Undo cancels the commit, so
  // nothing is ever deleted — no soft-delete / restore plumbing required.
  let pendingDeleteIds = $state(new Set<string>());

  const visibleItems = $derived($itemsForActiveList.filter((i) => !pendingDeleteIds.has(i.id)));

  const grouped = $derived(groupItemsByAisle(visibleItems, canonMap, aisleInfos));

  const allItemIds = $derived(visibleItems.map((i) => i.id));
  const totalItems = $derived(
    grouped.other.contributors.length +
      grouped.checked.contributors.length +
      grouped.aisles.reduce((sum, ag) => sum + ag.items.length, 0),
  );

  const isEmpty = $derived(!$isLoadingShoppingList && totalItems === 0);

  // ─── Collapsible groups ─────────────────────────────────────────────────────────

  // Checked starts collapsed — it's history, not the active shopping view.
  let checkedCollapsed = $state(true);

  // Aisle sections collapse on demand; tracked by aisle id (expanded by default).
  let collapsedAisles = $state(new Set<string>());

  function toggleAisle(aisleId: string): void {
    const next = new Set(collapsedAisles);
    if (next.has(aisleId)) next.delete(aisleId);
    else next.add(aisleId);
    collapsedAisles = next;
  }

  // ─── List switcher ──────────────────────────────────────────────────────────────

  let listSwitcherOpen = $state(false);

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
      addToast('Failed to add item.', 'destructive');
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
        addToast('Failed to update item.', 'destructive');
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
        addToast('Failed to update quantity.', 'destructive');
        editBusy = false;
        return;
      }
    }
    if (notesChanged) {
      const r = await updateItemNotes(params.listId, editingItem.id, editNotes);
      if (r.kind !== 'ok') {
        addToast('Failed to update notes.', 'destructive');
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
      addToast('Failed to delete item.', 'destructive');
    } else {
      editSheetOpen = false;
    }
  }

  // ─── Bulk actions ─────────────────────────────────────────────────────────────

  let bulkBusy = $state(false);
  let moveSheetOpen = $state(false);

  function unhidePending(ids: readonly string[]): void {
    const next = new Set(pendingDeleteIds);
    for (const id of ids) next.delete(id);
    pendingDeleteIds = next;
  }

  async function commitBulkDelete(ids: readonly string[]): Promise<void> {
    const result = await removeItems(params.listId, ids);
    if (result.kind !== 'ok') {
      addToast('Failed to delete items.', 'destructive');
    }
    // Either the items are gone from Firestore (success) or the delete failed and
    // they should reappear — in both cases stop hiding them.
    unhidePending(ids);
  }

  function handleBulkDelete(): void {
    if (selectedCount === 0) return;
    const ids = [...selected].filter((id) => allItemIds.includes(id));
    // Hide immediately and leave selection mode; commit (or undo) when the toast resolves.
    pendingDeleteIds = new Set([...pendingDeleteIds, ...ids]);
    selectionMode = false; // the $effect on selectionMode clears `selected`
    let undone = false;
    addToast(`${ids.length} item${ids.length === 1 ? '' : 's'} deleted`, 'default', {
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          unhidePending(ids);
        },
      },
      onDismiss: () => {
        if (!undone) void commitBulkDelete(ids);
      },
    });
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

  async function handleMoveTo(targetListId: string): Promise<void> {
    if (selectedCount === 0) return;
    bulkBusy = true;
    const ids = [...selected];
    const result = await moveSelectedItems(params.listId, targetListId, ids);
    bulkBusy = false;
    moveSheetOpen = false;
    if (result.kind !== 'ok') {
      addToast('Failed to move items.', 'destructive');
    } else {
      selectionMode = false;
    }
  }

  async function handleClearChecked(): Promise<void> {
    const result = await clearChecked(params.listId);
    if (result.kind !== 'ok') addToast('Failed to clear checked items.', 'destructive');
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

  function describeSource(src: ShoppingListItem['sources'][number]): string {
    if (src.kind === 'manual') return 'Added manually';
    const label = src.label ?? 'Recipe';
    const servings = `${src.servings} serving${src.servings === 1 ? '' : 's'}`;
    return `${label} (${servings})`;
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
    class="p-4 sm:p-6 {selectionMode ? 'pb-24' : ''}"
    data-testid="shopping-list-page"
  >
    {#snippet actions()}
      <Button
        variant="ghost"
        size="sm"
        onclick={() => push('/shopping/lists')}
        data-testid="shopping-lists-btn"
        aria-label="Manage lists"
      >
        <Icon name="LayoutList" size={16} />
      </Button>
    {/snippet}

    {#snippet titleSlot()}
      {#if $lists.length > 1}
        <Popover bind:open={listSwitcherOpen}>
          <PopoverTrigger>
            {#snippet children()}
              <button
                type="button"
                class="flex items-center gap-1 text-xl font-semibold tracking-tight text-foreground hover:opacity-75"
                data-testid="shopping-list-title-btn"
                aria-label="Switch list"
              >
                {currentList?.name ?? 'Shopping list'}
                <Icon name="ChevronDown" size={14} class="text-muted-foreground" />
              </button>
            {/snippet}
          </PopoverTrigger>
          <PopoverContent align="start" class="p-1 min-w-40">
            {#each $lists as list (list.id)}
              <button
                type="button"
                class="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent {list.id ===
                params.listId
                  ? 'font-medium'
                  : ''}"
                onclick={() => {
                  listSwitcherOpen = false;
                  push(`/shopping/${list.id}`);
                }}
                data-testid="shopping-list-picker-option"
              >
                {list.name}
              </button>
            {/each}
          </PopoverContent>
        </Popover>
      {:else}
        <h1 class="text-xl font-semibold tracking-tight text-foreground">
          {currentList?.name ?? 'Shopping list'}
        </h1>
      {/if}
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
    {/snippet}

    {#snippet empty()}
      <EmptyState title="Your list is empty" description="Add items above to get started." />
    {/snippet}

    {#snippet children()}
      <div class="flex flex-col gap-4" data-testid="shopping-list-content">
        <!-- Aisle groups -->
        {#each grouped.aisles as aisleGroup (aisleGroup.aisleId)}
          {@const aisleCollapsed = collapsedAisles.has(aisleGroup.aisleId)}
          <section
            class="flex flex-col gap-1"
            data-testid="shopping-aisle-group"
            data-aisle-id={aisleGroup.aisleId}
          >
            <button
              type="button"
              class="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1 hover:text-foreground"
              onclick={() => toggleAisle(aisleGroup.aisleId)}
              aria-expanded={!aisleCollapsed}
              data-testid="shopping-aisle-toggle"
            >
              <Icon name={aisleCollapsed ? 'ChevronRight' : 'ChevronDown'} size={14} />
              {aisleGroup.aisleName}
              {#if aisleCollapsed}
                <span class="normal-case text-muted-foreground/70">({aisleGroup.items.length})</span
                >
              {/if}
            </button>

            {#if !aisleCollapsed}
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
                      <span class="block text-xs text-muted-foreground/70">{sourceLabel(item)}</span
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
            {/if}
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
            <div class="flex items-center justify-between gap-2 mb-1">
              <button
                type="button"
                class="flex items-center gap-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground"
                onclick={() => (checkedCollapsed = !checkedCollapsed)}
                aria-expanded={!checkedCollapsed}
                data-testid="shopping-checked-toggle"
              >
                <Icon name={checkedCollapsed ? 'ChevronRight' : 'ChevronDown'} size={14} />
                Checked ({grouped.checked.contributors.length})
              </button>
              <Button
                variant="outline"
                size="sm"
                onclick={handleClearChecked}
                data-testid="shopping-clear-checked"
              >
                Clear checked
              </Button>
            </div>
            {#if !checkedCollapsed}
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
            {/if}
          </section>
        {/if}
      </div>
    {/snippet}
  </ListPage>
{/if}

<!-- Contextual bulk-action bar: while selecting, it occupies the bottom slot and
     covers the app's bottom nav (Android-style contextual action mode). -->
{#if selectionMode && selectedCount > 0}
  <div
    class="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card"
    role="toolbar"
    aria-label="Bulk actions"
    data-testid="shopping-bulk-bar"
  >
    <div class="mx-auto flex w-full max-w-lg items-stretch">
      <button
        type="button"
        class="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-40"
        onclick={handleBulkCheck}
        disabled={bulkBusy}
        data-testid="shopping-bulk-check"
      >
        <Icon name="CircleCheck" size={20} />
        Check
      </button>
      <button
        type="button"
        class="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-40"
        onclick={handleBulkUncheck}
        disabled={bulkBusy}
        data-testid="shopping-bulk-uncheck"
      >
        <Icon name="Circle" size={20} />
        Uncheck
      </button>
      <button
        type="button"
        class="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-40"
        onclick={() => (moveSheetOpen = true)}
        disabled={bulkBusy || otherLists.length === 0}
        data-testid="shopping-bulk-move-select"
      >
        <Icon name="FolderInput" size={20} />
        Move
      </button>
      <button
        type="button"
        class="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-40"
        onclick={handleBulkDelete}
        disabled={bulkBusy}
        data-testid="shopping-bulk-delete"
      >
        <Icon name="Trash2" size={20} />
        Delete
      </button>
    </div>
  </div>
{/if}

<!-- Move-to-list sheet -->
<Sheet bind:open={moveSheetOpen}>
  <SheetContent side="bottom" class="flex flex-col gap-2 p-4 pb-8">
    <SheetHeader>
      <SheetTitle>Move {selectedCount} item{selectedCount === 1 ? '' : 's'} to…</SheetTitle>
    </SheetHeader>
    <div class="flex flex-col">
      {#each otherLists as list (list.id)}
        <button
          type="button"
          class="w-full rounded px-3 py-3 text-left text-sm transition-colors hover:bg-accent disabled:opacity-40"
          onclick={() => handleMoveTo(list.id)}
          disabled={bulkBusy}
          data-testid="shopping-bulk-move-option"
        >
          {list.name}
        </button>
      {/each}
    </div>
  </SheetContent>
</Sheet>

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
      {#if editingItem && editingItem.sources.length > 0}
        <div class="flex flex-col gap-1.5" data-testid="shopping-edit-sources">
          <span class="text-sm font-medium">Sources</span>
          <ul class="flex flex-col gap-1">
            {#each editingItem.sources as src, i (i)}
              <li class="text-sm text-muted-foreground">{describeSource(src)}</li>
            {/each}
          </ul>
        </div>
      {/if}
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
