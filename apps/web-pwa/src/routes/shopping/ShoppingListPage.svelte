<script lang="ts">
  import {
    Button,
    Checkbox,
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
  import { push } from 'svelte-spa-router';
  import { groupItemsByAisle, combineItemsByUnit } from '@salt/domain';
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
      grouped.aisles.reduce(
        (sum, ag) => sum + ag.groups.reduce((s2, g) => s2 + g.contributors.length, 0),
        0,
      ),
  );

  const isEmpty = $derived(!$isLoadingShoppingList && totalItems === 0);

  // ─── Selection state ──────────────────────────────────────────────────────────

  let selected = $state(new Set<string>());

  const selectedCount = $derived(allItemIds.filter((id) => selected.has(id)).length);
  const allSelected = $derived(allItemIds.length > 0 && allItemIds.every((id) => selected.has(id)));
  const someSelected = $derived(allItemIds.some((id) => selected.has(id)) && !allSelected);

  function toggleSelection(id: string): void {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function toggleGroupSelection(itemIds: string[]): void {
    const allGroupSelected = itemIds.every((id) => selected.has(id));
    const next = new Set(selected);
    if (allGroupSelected) {
      for (const id of itemIds) next.delete(id);
    } else {
      for (const id of itemIds) next.add(id);
    }
    selected = next;
  }

  function toggleAll(): void {
    selected = allSelected ? new Set() : new Set(allItemIds);
  }

  // ─── Expanded groups ──────────────────────────────────────────────────────────

  let expandedGroups = $state(new Set<string>());

  function toggleGroup(canonId: string): void {
    const next = new Set(expandedGroups);
    if (next.has(canonId)) next.delete(canonId);
    else next.add(canonId);
    expandedGroups = next;
  }

  // ─── Item capture ─────────────────────────────────────────────────────────────

  let newItemText = $state('');
  let addBusy = $state(false);

  async function handleAddItem(): Promise<void> {
    const text = newItemText.trim();
    if (!text) return;
    addBusy = true;
    const result = await addItemToList(params.listId, text);
    addBusy = false;
    if (result.kind !== 'ok') {
      addToast('Failed to add item.', 'error');
    } else {
      newItemText = '';
    }
  }

  // ─── Edit sheet ───────────────────────────────────────────────────────────────

  let editSheetOpen = $state(false);
  let editingItem = $state<ShoppingListItem | null>(null);
  let editRawText = $state('');
  let editNotes = $state('');
  let editBusy = $state(false);
  let editDeleteBusy = $state(false);

  function openEditSheet(item: ShoppingListItem): void {
    editingItem = item;
    editRawText = item.rawText;
    editNotes = item.notes;
    editSheetOpen = true;
  }

  async function handleEditSave(): Promise<void> {
    if (!editingItem) return;
    editBusy = true;
    const rawChanged = editRawText.trim() !== editingItem.rawText;
    const notesChanged = editNotes.trim() !== editingItem.notes;
    if (rawChanged) {
      const r = await updateItemRawText(params.listId, editingItem.id, editRawText);
      if (r.kind !== 'ok') {
        addToast('Failed to update item.', 'error');
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

  function formatSlotAmount(amount: number | undefined, unit: string | undefined): string | null {
    if (amount === undefined) return null;
    return unit ? `${amount} ${unit}` : `${amount}`;
  }

  function toggleSlotSelection(ids: string[]): void {
    const next = new Set(selected);
    const allSel = ids.every((id) => next.has(id));
    if (allSel) {
      for (const id of ids) next.delete(id);
    } else {
      for (const id of ids) next.add(id);
    }
    selected = next;
  }

  async function toggleSlotChecked(items: readonly ShoppingListItem[]): Promise<void> {
    const allChecked = items.every((i) => i.checked);
    if (allChecked) {
      await uncheckItems(
        params.listId,
        items.map((i) => i.id),
      );
    } else {
      await checkItems(
        params.listId,
        items.map((i) => i.id),
      );
    }
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
      <TextField
        bind:value={newItemText}
        placeholder="Add an item…"
        disabled={addBusy}
        class="flex-1"
        data-testid="shopping-item-input"
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void handleAddItem();
          }
        }}
      />
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

            {#each aisleGroup.groups as group (group.canonId)}
              {@const groupIds = group.contributors.map((c) => c.id)}
              {@const allGroupSelected = groupIds.every((id) => selected.has(id))}
              {@const someGroupSelected =
                groupIds.some((id) => selected.has(id)) && !allGroupSelected}
              {@const isExpanded = expandedGroups.has(group.canonId)}
              {@const unitSlots = combineItemsByUnit(group.contributors)}

              {#if unitSlots.length === 1}
                <!-- Single slot (all contributors share the same unit): one combined row -->
                {@const slot = unitSlots[0]!}
                {@const slotIds = slot.entries.map((e) => e.id)}
                {@const slotAllSelected = slotIds.every((id) => selected.has(id))}
                {@const slotSomeSelected =
                  slotIds.some((id) => selected.has(id)) && !slotAllSelected}
                {@const slotAllChecked = slot.entries.every((e) => e.checked)}
                {@const slotSomeChecked = slot.entries.some((e) => e.checked) && !slotAllChecked}
                {@const slotDisplayName =
                  slot.entries.length === 1
                    ? toSentenceCase(slot.entries[0]!.rawText)
                    : toSentenceCase(group.canonName)}
                {@const slotAmountStr = formatSlotAmount(slot.combinedAmount, slot.unit)}
                {@const singleItem = slot.entries.length === 1 ? slot.entries[0]! : null}
                <div
                  class="flex items-center gap-3 rounded-md border px-3 py-2 text-sm {slotAllSelected
                    ? 'border-ring ring-2 ring-ring bg-card'
                    : 'border-border bg-card'}"
                  data-testid="shopping-item-row"
                  data-item-id={singleItem?.id}
                >
                  <Checkbox
                    checked={slotAllSelected ? true : slotSomeSelected ? 'indeterminate' : false}
                    onCheckedChange={() => toggleSlotSelection(slotIds)}
                    label=""
                    aria-label="Select {slotDisplayName}"
                  />
                  {#if singleItem}
                    <button
                      type="button"
                      class="flex-1 min-w-0 text-left"
                      onclick={() => openEditSheet(singleItem)}
                      aria-label="Edit {slotDisplayName}"
                      data-testid="shopping-item-edit-btn"
                    >
                      <span class="block truncate">
                        {slotDisplayName}
                      </span>
                      {#if slotAmountStr}
                        <span class="block text-xs text-muted-foreground">{slotAmountStr}</span>
                      {/if}
                      {#if singleItem.notes}
                        <span class="block text-xs text-muted-foreground truncate"
                          >{toSentenceCase(singleItem.notes)}</span
                        >
                      {/if}
                      {#if sourceLabel(singleItem)}
                        <span class="block text-xs text-muted-foreground/70"
                          >{sourceLabel(singleItem)}</span
                        >
                      {/if}
                    </button>
                  {:else}
                    <div class="flex-1 min-w-0">
                      <span class="block truncate">
                        {slotDisplayName}
                      </span>
                      {#if slotAmountStr}
                        <span class="block text-xs text-muted-foreground">{slotAmountStr}</span>
                      {/if}
                    </div>
                  {/if}
                  <Checkbox
                    checked={slotAllChecked ? true : slotSomeChecked ? 'indeterminate' : false}
                    onCheckedChange={() => void toggleSlotChecked(slot.entries)}
                    label=""
                    aria-label="Mark as done"
                    data-testid="shopping-item-check"
                  />
                </div>
              {:else}
                <!-- Multiple slots (different units): collapsible group, one row per slot -->
                <div
                  class="flex flex-col gap-0.5"
                  data-testid="shopping-canon-group"
                  data-canon-id={group.canonId}
                >
                  <!-- Group header row -->
                  <div
                    class="flex items-center gap-3 rounded-md border px-3 py-2 text-sm {allGroupSelected
                      ? 'border-ring ring-2 ring-ring bg-card'
                      : 'border-border bg-card'}"
                  >
                    <Checkbox
                      checked={allGroupSelected
                        ? true
                        : someGroupSelected
                          ? 'indeterminate'
                          : false}
                      onCheckedChange={() => toggleGroupSelection(groupIds)}
                      label=""
                      aria-label="Select all in {group.canonName}"
                    />
                    <button
                      type="button"
                      class="flex-1 min-w-0 flex items-center gap-2 text-left"
                      onclick={() => toggleGroup(group.canonId)}
                      aria-label={isExpanded
                        ? 'Collapse {group.canonName}'
                        : 'Expand {group.canonName}'}
                      data-testid="shopping-group-toggle"
                    >
                      <span class="font-medium truncate">
                        {toSentenceCase(group.canonName)}
                      </span>
                      <span
                        class="text-xs bg-muted text-muted-foreground rounded px-1.5 py-0.5 shrink-0"
                      >
                        +{unitSlots.length}
                      </span>
                      <Icon
                        name={isExpanded ? 'ChevronUp' : 'ChevronDown'}
                        size={14}
                        class="ml-auto shrink-0 text-muted-foreground"
                      />
                    </button>
                  </div>

                  <!-- Expanded slot rows -->
                  {#if isExpanded}
                    <div class="ml-6 flex flex-col gap-0.5">
                      {#each unitSlots as slot}
                        {@const slotIds = slot.entries.map((e) => e.id)}
                        {@const slotAllSelected = slotIds.every((id) => selected.has(id))}
                        {@const slotSomeSelected =
                          slotIds.some((id) => selected.has(id)) && !slotAllSelected}
                        {@const slotAllChecked = slot.entries.every((e) => e.checked)}
                        {@const slotSomeChecked =
                          slot.entries.some((e) => e.checked) && !slotAllChecked}
                        {@const slotDisplayName =
                          slot.entries.length === 1
                            ? toSentenceCase(slot.entries[0]!.rawText)
                            : toSentenceCase(group.canonName)}
                        {@const slotAmountStr = formatSlotAmount(slot.combinedAmount, slot.unit)}
                        {@const singleItem = slot.entries.length === 1 ? slot.entries[0]! : null}
                        <div
                          class="flex items-center gap-3 rounded-md border px-3 py-2 text-sm {slotAllSelected
                            ? 'border-ring ring-2 ring-ring bg-card'
                            : 'border-border bg-muted/30'}"
                          data-testid="shopping-item-row"
                          data-item-id={singleItem?.id}
                        >
                          <Checkbox
                            checked={slotAllSelected
                              ? true
                              : slotSomeSelected
                                ? 'indeterminate'
                                : false}
                            onCheckedChange={() => toggleSlotSelection(slotIds)}
                            label=""
                            aria-label="Select {slotDisplayName}"
                          />
                          {#if singleItem}
                            <button
                              type="button"
                              class="flex-1 min-w-0 text-left"
                              onclick={() => openEditSheet(singleItem)}
                              aria-label="Edit {slotDisplayName}"
                              data-testid="shopping-item-edit-btn"
                            >
                              <span
                                class="block truncate {slotAllChecked
                                  ? 'line-through text-muted-foreground'
                                  : ''}"
                              >
                                {slotDisplayName}
                              </span>
                              {#if slotAmountStr}
                                <span class="block text-xs text-muted-foreground"
                                  >{slotAmountStr}</span
                                >
                              {/if}
                              {#if singleItem.notes}
                                <span class="block text-xs text-muted-foreground truncate"
                                  >{toSentenceCase(singleItem.notes)}</span
                                >
                              {/if}
                              {#if sourceLabel(singleItem)}
                                <span class="block text-xs text-muted-foreground/70"
                                  >{sourceLabel(singleItem)}</span
                                >
                              {/if}
                            </button>
                          {:else}
                            <div class="flex-1 min-w-0">
                              <span
                                class="block truncate {slotAllChecked
                                  ? 'line-through text-muted-foreground'
                                  : ''}"
                              >
                                {slotDisplayName}
                              </span>
                              {#if slotAmountStr}
                                <span class="block text-xs text-muted-foreground"
                                  >{slotAmountStr}</span
                                >
                              {/if}
                            </div>
                          {/if}
                          <Checkbox
                            checked={slotAllChecked
                              ? true
                              : slotSomeChecked
                                ? 'indeterminate'
                                : false}
                            onCheckedChange={() => void toggleSlotChecked(slot.entries)}
                            label=""
                            aria-label="Mark as done"
                            data-testid="shopping-item-check"
                          />
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
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
              <div
                class="flex items-center gap-3 rounded-md border px-3 py-2 text-sm {isSelected
                  ? 'border-ring ring-2 ring-ring bg-card'
                  : 'border-border bg-card'}"
                data-testid="shopping-item-row"
                data-item-id={item.id}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleSelection(item.id)}
                  label=""
                  aria-label="Select {item.rawText}"
                />
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
                    {toSentenceCase(item.rawText)}
                  </span>
                  {#if formatSlotAmount(item.amount, item.unit)}
                    <span class="block text-xs text-muted-foreground"
                      >{formatSlotAmount(item.amount, item.unit)}</span
                    >
                  {/if}
                  {#if item.notes}
                    <span class="block text-xs text-muted-foreground truncate"
                      >{toSentenceCase(item.notes)}</span
                    >
                  {/if}
                </button>
                {#if isPending}
                  <Spinner size={14} />
                {/if}
                <Checkbox
                  checked={item.checked}
                  onCheckedChange={() => void toggleItemChecked(params.listId, item)}
                  label=""
                  aria-label="Mark as done"
                  data-testid="shopping-item-check"
                />
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
              <div
                class="flex items-center gap-3 rounded-md border px-3 py-2 text-sm {isSelected
                  ? 'border-ring ring-2 ring-ring bg-card'
                  : 'border-border bg-card'}"
                data-testid="shopping-item-row"
                data-item-id={item.id}
              >
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleSelection(item.id)}
                  label=""
                  aria-label="Select {item.rawText}"
                />
                <button
                  type="button"
                  class="flex-1 min-w-0 text-left"
                  onclick={() => openEditSheet(item)}
                  aria-label="Edit {item.rawText}"
                  data-testid="shopping-item-edit-btn"
                >
                  <span class="block truncate line-through text-muted-foreground">
                    {toSentenceCase(item.rawText)}
                  </span>
                  {#if formatSlotAmount(item.amount, item.unit)}
                    <span class="block text-xs text-muted-foreground/60"
                      >{formatSlotAmount(item.amount, item.unit)}</span
                    >
                  {/if}
                  {#if item.notes}
                    <span class="block text-xs text-muted-foreground/60 truncate"
                      >{toSentenceCase(item.notes)}</span
                    >
                  {/if}
                </button>
                <Checkbox
                  checked={item.checked}
                  onCheckedChange={() => void toggleItemChecked(params.listId, item)}
                  label=""
                  aria-label="Uncheck"
                  data-testid="shopping-item-check"
                />
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
