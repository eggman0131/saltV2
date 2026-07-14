<script lang="ts">
  import {
    Button,
    CanonIcon,
    Combobox,
    ComboboxContent,
    ComboboxCreate,
    ComboboxEmpty,
    ComboboxField,
    ComboboxInput,
    ComboboxItem,
    Icon,
    ListPage,
    RowSelectCheckbox,
    SelectAllCheckbox,
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
    createListSelection,
  } from '@salt/ui-components';
  import { titleCase } from '../../lib/titleCase.js';
  import { tick } from 'svelte';
  import { push } from 'svelte-spa-router';
  import {
    groupItemsByAisle,
    groupItemsByRecipe,
    resolveItemDisplayName,
    resolveProductForm,
  } from '@salt/domain';
  import type { ShoppingListItem, AisleRow, AmountSubtotal, ProductForm } from '@salt/domain';
  import { canonItems, aisles } from '../../lib/canonService.js';
  import { productForms } from '../../lib/productFormService.js';
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
    confirmItemNeeded,
    confirmItemsNeeded,
  } from '../../lib/shoppingListService.svelte.js';
  import { addToast } from '../../lib/toastStore.js';
  import { createDeferredDelete } from '../../lib/deferredDelete.svelte.js';
  import type { BulkAction } from '@salt/ui-components';

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
    new Map(
      $canonItems.map((ci) => [
        ci.id,
        {
          id: ci.id,
          name: ci.name,
          aisleId: ci.aisleId,
          thumbnail: ci.thumbnail,
          iconRequestedAt: ci.iconRequestedAt,
          updatedAt: ci.updatedAt,
        },
      ]),
    ),
  );

  // Tri-state icon thumbnail for a row, looked up by its matched canon id.
  // Returns null (→ bare tile) for unmatched/pending rows.
  function thumbnailFor(canonId: string | null): string | null {
    if (!canonId) return null;
    return canonMap.get(canonId)?.thumbnail ?? null;
  }

  // Cache-bust nonce for the matched canon item's icon, resolved via the same
  // canon lookup as `thumbnailFor`. Mirrors the canon pages' render sites
  // (`iconRequestedAt ?? updatedAt`) so a regenerated icon re-fetches instead of
  // serving stale. undefined for unmatched/pending rows (→ raw URL passthrough).
  function iconVersionFor(canonId: string | null): string | number | undefined {
    if (!canonId) return undefined;
    const ci = canonMap.get(canonId);
    return ci ? (ci.iconRequestedAt ?? ci.updatedAt) : undefined;
  }

  const aisleInfos = $derived($aisles.map((a) => ({ id: a.id, name: a.name, order: a.order })));

  // ─── Deferred bulk delete ───────────────────────────────────────────────────────
  // Selected items are hidden immediately, but the real Firestore delete is only
  // committed once the undo window closes. Pressing Undo cancels the commit, so
  // nothing is ever deleted — no soft-delete / restore plumbing required.
  const deferredDelete = createDeferredDelete();

  const visibleItems = $derived(deferredDelete.visible($itemsForActiveList));

  // ─── Sort mode ──────────────────────────────────────────────────────────────
  // Toggle between grouping by aisle (default) and by source recipe. Ephemeral —
  // resets on reload; no Firestore/local-storage backing (storage rules forbid it).
  let sortMode = $state<'aisle' | 'recipe'>('aisle');

  // ─── Verify filter ───────────────────────────────────────────────────────────
  // When the list holds amber "Need it?" items (recipe-add flagged, #185), offer a
  // toggle that narrows the view to just those, so the shopper can resolve them in
  // one pass. The button only appears while such items exist; clearing the last one
  // drops the filter so the full list returns (effect below).
  const verifyItems = $derived(visibleItems.filter((i) => needsVerify(i)));
  const hasVerifyItems = $derived(verifyItems.length > 0);
  let verifyFilterActive = $state(false);

  $effect(() => {
    if (verifyFilterActive && !hasVerifyItems) verifyFilterActive = false;
  });

  // Items fed into grouping/selection — narrowed to verify items when the filter
  // is on. `isEmpty` stays keyed off the full list so the empty state means "no
  // items", never "filtered to none".
  const displayItems = $derived(verifyFilterActive ? verifyItems : visibleItems);

  // Declared here (ahead of the selection block below) because the `grouped`
  // derived reads it — a `$derived` is lazy at runtime, but the `let` must still
  // be declared before its first textual use.
  let selectionMode = $state(false);

  // Combine recipe-sourced rows in the normal view; in selection mode show every
  // item individually so bulk check/delete/move act per-item (issue #184).
  const grouped = $derived(
    groupItemsByAisle(displayItems, canonMap, aisleInfos, { combine: !selectionMode }),
  );

  // Recipe-sorted view: recipe groups, then a Manual section, then checked.
  const recipeGrouped = $derived(groupItemsByRecipe(displayItems));

  const allItemIds = $derived(displayItems.map((i) => i.id));

  const isEmpty = $derived(!$isLoadingShoppingList && visibleItems.length === 0);

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

  // ─── Overflow menu ────────────────────────────────────────────────────────────

  let overflowMenuOpen = $state(false);

  function selectSortMode(mode: 'aisle' | 'recipe'): void {
    sortMode = mode;
    overflowMenuOpen = false;
  }

  // ─── Selection state ──────────────────────────────────────────────────────────
  // `selectionMode` itself is declared above (before the `grouped` derived that
  // reads it).

  const selection = createListSelection({
    getAllIds: () => allItemIds,
    isSelectionMode: () => selectionMode,
  });

  // ─── Item capture ─────────────────────────────────────────────────────────────

  let newItemText = $state('');
  let addBusy = $state(false);
  let comboboxResetKey = $state(0);
  // Wrapper around the add combobox; stable across the {#key} remount, so we can
  // find and refocus the freshly-mounted input after an item is added.
  let addFieldEl = $state<HTMLDivElement | undefined>(undefined);

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
      // Remounting the combobox drops focus; return it to the fresh input so the
      // user can keep adding items without re-tapping the field.
      await tick();
      addFieldEl?.querySelector('input')?.focus();
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

  function handleBulkDelete(): void {
    if (selection.count === 0) return;
    const ids = selection.ids;
    // Hide immediately and leave selection mode; commit (or undo) when the toast resolves.
    selectionMode = false; // exiting selection mode clears the selection
    deferredDelete.request(ids, async (delIds) => {
      const result = await removeItems(params.listId, delIds);
      if (result.kind !== 'ok') addToast('Failed to delete items.', 'destructive');
    });
  }

  async function handleBulkCheck(): Promise<void> {
    if (selection.count === 0) return;
    bulkBusy = true;
    await checkItems(params.listId, [...selection.selected]);
    bulkBusy = false;
    selection.clear();
  }

  async function handleBulkUncheck(): Promise<void> {
    if (selection.count === 0) return;
    bulkBusy = true;
    await uncheckItems(params.listId, [...selection.selected]);
    bulkBusy = false;
    selection.clear();
  }

  async function handleMoveTo(targetListId: string): Promise<void> {
    if (selection.count === 0) return;
    bulkBusy = true;
    const ids = [...selection.selected];
    const result = await moveSelectedItems(params.listId, targetListId, ids);
    bulkBusy = false;
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

  // Contextual bottom action bar, supplied to ListPage. The template owns the bar
  // chrome, the move picker sheet, and the BottomNav takeover.
  const bulkActions = $derived<BulkAction[]>([
    {
      id: 'check',
      label: 'Check',
      icon: 'CircleCheck',
      disabled: bulkBusy,
      testId: 'shopping-bulk-check',
      onSelect: () => void handleBulkCheck(),
    },
    {
      id: 'uncheck',
      label: 'Uncheck',
      icon: 'Circle',
      disabled: bulkBusy,
      testId: 'shopping-bulk-uncheck',
      onSelect: () => void handleBulkUncheck(),
    },
    {
      kind: 'picker',
      id: 'move',
      label: 'Move',
      icon: 'FolderInput',
      disabled: bulkBusy || otherLists.length === 0,
      testId: 'shopping-bulk-move-select',
      sheetTitle: `Move ${selection.count} item${selection.count === 1 ? '' : 's'} to…`,
      targets: otherLists.map((l) => ({ id: l.id, label: l.name })),
      optionTestId: 'shopping-bulk-move-option',
      onPick: (id) => void handleMoveTo(id),
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: 'Trash2',
      variant: 'destructive',
      disabled: bulkBusy,
      testId: 'shopping-bulk-delete',
      onSelect: handleBulkDelete,
    },
  ]);

  // ─── Item row helper ──────────────────────────────────────────────────────────

  function toSentenceCase(text: string): string {
    if (!text) return text;
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // Label a single row, title-cased: the user's / recipe's wording with the
  // amount, unit and context the parser lifts out removed ("1 whole chicken" →
  // "Whole Chicken"), so it reads as the item without the quantity that's shown
  // separately, and without collapsing to the leaner canon name ("Chicken").
  // Combined aggregate rows label by canon name instead — see rowLabel.
  function displayLabel(item: ShoppingListItem): string {
    return titleCase(resolveItemDisplayName(item));
  }

  // A resolved product-form row (issue #500): a recipe row bound to a buyable
  // parent canon and carrying a whole parent-count (the recipeService 'count' unit
  // sentinel), re-derived from the productForms snapshot rather than a stored id
  // (additive / back-compat). null for manual rows, non-count rows, and any row
  // whose form no longer resolves to its own canon — those keep today's label.
  // When non-null the row reads "Lime ×3" with the original wording underneath.
  function productFormFor(item: ShoppingListItem): ProductForm | null {
    if (item.unit !== 'count' || !item.canonId || item.amount === undefined) return null;
    const form = resolveProductForm(item.rawText, $productForms);
    return form && form.parentCanonId === item.canonId ? form : null;
  }

  function sourceLabel(item: ShoppingListItem): string {
    const src = item.sources[0];
    if (!src) return '';
    if (src.kind === 'manual') return src.addedBy ? `Added by ${src.addedBy}` : '';
    if (src.kind === 'recipe') return src.label ?? 'Recipe';
    return '';
  }

  function formatAmount(amount: number | undefined, unit: string | undefined): string | null {
    if (amount === undefined) return null;
    return unit ? `${amount} ${unit}` : `${amount}`;
  }

  // ─── Verify flag (recipe-add "check" items, #185) ───────────────────────────
  // A flagged item is highlighted with a quick confirm/drop affordance so the
  // shopper can resolve it without opening the edit sheet. The controls act on a
  // set of ids: a single item, or the flagged contributors of a combined row.
  function needsVerify(item: ShoppingListItem): boolean {
    return item.needsCheck && !item.checked;
  }

  async function handleConfirmNeeded(ids: readonly string[]): Promise<void> {
    const [singleId] = ids;
    if (ids.length === 1 && singleId !== undefined) {
      const result = await confirmItemNeeded(params.listId, singleId);
      if (result.kind !== 'ok') addToast('Failed to update item.', 'destructive');
      return;
    }
    await confirmItemsNeeded(params.listId, ids);
  }

  async function handleDropNeeded(ids: readonly string[]): Promise<void> {
    const result = await removeItems(params.listId, ids);
    if (result.kind !== 'ok') addToast('Failed to remove item.', 'destructive');
  }

  // ─── Aisle rows (combining, #184) ───────────────────────────────────────────
  // A combined row stands for several recipe contributions of the same canon.
  // Tapping it reveals the per-contributor breakdown; row-level actions act on
  // all contributors.
  let expandedRows = $state(new Set<string>());

  function toggleRow(key: string): void {
    const next = new Set(expandedRows);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedRows = next;
  }

  function rowLabel(row: AisleRow): string {
    if (row.combined) return titleCase(canonMap.get(row.canonId)?.name ?? '');
    const first = row.contributors[0];
    return first ? displayLabel(first) : '';
  }

  function formatSubtotals(subtotals: readonly AmountSubtotal[]): string | null {
    if (subtotals.length === 0) return null;
    return subtotals.map((s) => (s.unit ? `${s.amount} ${s.unit}` : `${s.amount}`)).join(' + ');
  }

  function rowIds(row: AisleRow): string[] {
    return row.contributors.map((c) => c.id);
  }

  function flaggedIds(row: AisleRow): string[] {
    return row.contributors.filter((c) => c.needsCheck).map((c) => c.id);
  }

  async function markRowDone(row: AisleRow): Promise<void> {
    await checkItems(params.listId, rowIds(row));
  }

  function describeSource(src: ShoppingListItem['sources'][number]): string {
    if (src.kind === 'manual') return src.addedBy ? `Added by ${src.addedBy}` : 'Added manually';
    const label = src.label ?? 'Recipe';
    const servings = `${src.servings} serving${src.servings === 1 ? '' : 's'}`;
    return `${label} (${servings})`;
  }
</script>

{#snippet verifyControls(ids: string[])}
  <div class="flex items-center gap-2" data-testid="shopping-verify">
    <span class="text-xs font-medium text-amber-600 dark:text-amber-500">Need it?</span>
    <button
      type="button"
      class="flex h-10 w-10 items-center justify-center rounded-md text-amber-600 hover:bg-amber-100 dark:text-amber-500 dark:hover:bg-amber-950"
      onclick={() => void handleConfirmNeeded(ids)}
      aria-label="Confirm needed"
      data-testid="shopping-verify-confirm"
    >
      <Icon name="Check" size={20} />
    </button>
    <button
      type="button"
      class="flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      onclick={() => void handleDropNeeded(ids)}
      aria-label="Not needed, remove"
      data-testid="shopping-verify-drop"
    >
      <Icon name="X" size={20} />
    </button>
  </div>
{/snippet}

{#snippet plainItemRow(
  item: ShoppingListItem,
  pending: boolean,
  subordinate = false,
  showSource = false,
)}
  {@const isSelected = selection.isSelected(item.id)}
  {@const amountStr = formatAmount(item.amount, item.unit)}
  {@const productForm = productFormFor(item)}
  <div
    class="flex items-center gap-3 rounded border px-3 py-2 text-sm {subordinate
      ? 'ml-[46px]'
      : ''} {isSelected
      ? 'border-ring ring-2 ring-ring bg-card'
      : needsVerify(item)
        ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20'
        : 'border-border bg-card'}"
    data-testid="shopping-item-row"
    data-item-id={item.id}
  >
    {#if selectionMode}
      <RowSelectCheckbox {selection} id={item.id} label="" aria-label="Select {item.rawText}" />
    {/if}
    {#if !subordinate}
      <CanonIcon
        thumbnail={thumbnailFor(item.canonId)}
        name={displayLabel(item)}
        dimmed={item.checked}
        size={34}
        version={iconVersionFor(item.canonId)}
      />
    {/if}
    <button
      type="button"
      class="flex-1 min-w-0 text-left"
      onclick={() => openEditSheet(item)}
      aria-label="Edit {item.rawText}"
      data-testid="shopping-item-edit-btn"
    >
      {#if productForm}
        <span class="block truncate {item.checked ? 'line-through text-muted-foreground' : ''}">
          {titleCase(canonMap.get(item.canonId ?? '')?.name ?? '')}{' '}<span
            class="text-muted-foreground">×{item.amount}</span
          >
        </span>
        <span class="block text-xs text-muted-foreground truncate"
          >{resolveItemDisplayName(item)}</span
        >
      {:else}
        <span class="block truncate {item.checked ? 'line-through text-muted-foreground' : ''}">
          {displayLabel(item)}{#if amountStr}{' '}<span class="text-muted-foreground"
              >({amountStr})</span
            >{/if}
        </span>
      {/if}
      {#if item.notes}
        <span class="block text-xs text-muted-foreground truncate"
          >{toSentenceCase(item.notes)}</span
        >
      {/if}
      {#if showSource && sourceLabel(item)}
        <span class="block text-xs text-muted-foreground/70">{sourceLabel(item)}</span>
      {/if}
    </button>
    {#if pending}
      <Spinner size={14} />
    {/if}
    {#if needsVerify(item)}
      {@render verifyControls([item.id])}
    {:else}
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
    {/if}
  </div>
{/snippet}

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
    selectionCount={selection.count}
    {bulkActions}
    class="p-4 sm:p-6"
    data-testid="shopping-list-page"
  >
    {#snippet actions()}
      {#if hasVerifyItems}
        <button
          type="button"
          class="inline-flex items-center gap-1 rounded-md h-8 px-2 text-xs font-medium transition-colors {verifyFilterActive
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
            : 'text-amber-600 hover:bg-amber-50 dark:text-amber-500 dark:hover:bg-amber-950/40'}"
          onclick={() => (verifyFilterActive = !verifyFilterActive)}
          aria-pressed={verifyFilterActive}
          aria-label={verifyFilterActive ? 'Show all items' : 'Show only items to verify'}
          data-testid="shopping-verify-filter"
        >
          <Icon name="ListFilter" size={14} />
          {verifyItems.length}
        </button>
      {/if}
      <Popover bind:open={overflowMenuOpen}>
        <PopoverTrigger>
          {#snippet children()}
            <button
              type="button"
              class="inline-flex items-center justify-center rounded-md h-8 w-8 text-foreground hover:bg-accent hover:text-accent-foreground"
              data-testid="shopping-overflow-btn"
              aria-label="List options"
            >
              <Icon name="EllipsisVertical" size={16} />
            </button>
          {/snippet}
        </PopoverTrigger>
        <PopoverContent align="end" class="p-1 min-w-52">
          <p class="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Sort by
          </p>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            onclick={() => selectSortMode('aisle')}
            data-testid="shopping-sort-aisle"
          >
            <Icon name="Check" size={14} class={sortMode === 'aisle' ? '' : 'invisible'} />
            Aisle
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            onclick={() => selectSortMode('recipe')}
            data-testid="shopping-sort-recipe"
          >
            <Icon name="Check" size={14} class={sortMode === 'recipe' ? '' : 'invisible'} />
            Recipe
          </button>
          <div class="my-1 h-px bg-border"></div>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            onclick={() => {
              overflowMenuOpen = false;
              push('/shopping/lists');
            }}
            data-testid="shopping-lists-btn"
          >
            <Icon name="LayoutList" size={14} />
            Manage lists
          </button>
        </PopoverContent>
      </Popover>
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
        bind:this={addFieldEl}
        oninput={(e) => {
          newItemText = (e.target as HTMLInputElement).value;
        }}
      >
        {#key comboboxResetKey}
          <Combobox
            items={comboItems}
            allowCustom={true}
            openOnClick={false}
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
      <SelectAllCheckbox {selection} />
    {/snippet}

    {#snippet empty()}
      <EmptyState title="Your list is empty" description="Add items above to get started." />
    {/snippet}

    {#snippet children()}
      <div class="flex flex-col gap-4" data-testid="shopping-list-content">
        {#if sortMode === 'aisle'}
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
                  <span class="normal-case text-muted-foreground/70"
                    >({aisleGroup.rows.length})</span
                  >
                {/if}
              </button>

              {#if !aisleCollapsed}
                {#each aisleGroup.rows as row (row.key)}
                  {@const amountStr = formatSubtotals(row.subtotals)}
                  {#if row.combined}
                    {@const expanded = expandedRows.has(row.key)}
                    <div
                      class="flex items-center gap-3 rounded border px-3 py-2 text-sm {row.needsCheck
                        ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/20'
                        : 'border-border bg-card'}"
                      data-testid="shopping-item-row"
                      data-combined="true"
                      data-canon-id={row.canonId}
                    >
                      <CanonIcon
                        thumbnail={thumbnailFor(row.canonId)}
                        name={rowLabel(row)}
                        size={34}
                        version={iconVersionFor(row.canonId)}
                      />
                      <button
                        type="button"
                        class="flex-1 min-w-0 text-left"
                        onclick={() => toggleRow(row.key)}
                        aria-expanded={expanded}
                        data-testid="shopping-combined-toggle"
                      >
                        <span class="block truncate">
                          {rowLabel(row)}{#if amountStr}{' '}<span class="text-muted-foreground"
                              >({amountStr})</span
                            >{/if}
                        </span>
                        <span class="flex items-center gap-1 text-xs text-muted-foreground/70">
                          <Icon name={expanded ? 'ChevronDown' : 'ChevronRight'} size={12} />
                          {row.contributors.length} recipes
                        </span>
                      </button>
                      {#if row.needsCheck}
                        {@render verifyControls(flaggedIds(row))}
                      {:else}
                        <button
                          type="button"
                          class="flex items-center justify-center p-1 rounded text-muted-foreground transition-colors hover:text-foreground"
                          onclick={() => void markRowDone(row)}
                          aria-label="Mark as done"
                          data-testid="shopping-item-check"
                        >
                          <Icon name="Circle" size={18} />
                        </button>
                      {/if}
                    </div>
                    {#if expanded}
                      <div
                        class="flex flex-col gap-1 pb-1"
                        data-testid="shopping-combined-breakdown"
                      >
                        {#each row.contributors as c (c.id)}
                          {@render plainItemRow(c, false, true, true)}
                        {/each}
                      </div>
                    {/if}
                  {:else}
                    {@const single = row.contributors[0]}
                    {#if single}
                      {@render plainItemRow(single, false, false, true)}
                    {/if}
                  {/if}
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
                {@render plainItemRow(item, isPending)}
              {/each}
            </section>
          {/if}
        {:else}
          <!-- Recipe groups -->
          {#each recipeGrouped.recipes as recipeGroup (recipeGroup.recipeId)}
            <section
              class="flex flex-col gap-1"
              data-testid="shopping-recipe-group"
              data-recipe-id={recipeGroup.recipeId}
            >
              <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                {recipeGroup.recipeName}
              </p>
              {#each recipeGroup.items as item (item.id)}
                {@render plainItemRow(item, item.matchState === 'pending')}
              {/each}
            </section>
          {/each}

          <!-- Manual items -->
          {#if recipeGrouped.manual.items.length > 0}
            <section class="flex flex-col gap-1" data-testid="shopping-manual-group">
              <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Manual
              </p>
              {#each recipeGrouped.manual.items as item (item.id)}
                {@render plainItemRow(item, item.matchState === 'pending')}
              {/each}
            </section>
          {/if}
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
                {@render plainItemRow(item, false)}
              {/each}
            {/if}
          </section>
        {/if}
      </div>
    {/snippet}
  </ListPage>
{/if}

<!-- Edit item sheet -->
<Sheet
  bind:open={editSheetOpen}
  side="bottom"
  onOpenChange={(v) => {
    if (!v) {
      editingItem = null;
    }
  }}
>
  <SheetContent class="flex flex-col gap-4 p-4 pb-8">
    <SheetHeader>
      <div class="flex items-center gap-3">
        {#if editingItem}
          <CanonIcon
            thumbnail={thumbnailFor(editingItem.canonId)}
            name={displayLabel(editingItem)}
            size={64}
            version={iconVersionFor(editingItem.canonId)}
          />
        {/if}
        <SheetTitle>Edit item</SheetTitle>
      </div>
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
