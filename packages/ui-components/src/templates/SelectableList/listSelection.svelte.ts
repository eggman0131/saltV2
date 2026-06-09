// spec: ui-spec-v04.md §10 v0.4
//
// The single source of truth for list multi-selection. Every list page used to
// hand-roll the same `selected` Set plus `allSelected` / `someSelected` /
// `selectedCount` deriveds and `toggle` / `toggleAll` helpers. This factory owns
// that logic once so the four list pages (shopping, canon, aisle, equipment) and
// the shared `SelectableList` / `SelectAllCheckbox` / `RowSelectCheckbox`
// components all read from the same controller.
//
// Selection mode is *sourced from* the page (whose `selectionMode` is bound to
// `ListPage`) rather than re-implemented here — exiting selection mode clears the
// selection automatically, replacing the per-page `$effect`.

export type ListSelection = {
  /** Whether the host list is currently in selection mode. */
  readonly selectionMode: boolean;
  /** Live set of selected ids (reactive). */
  readonly selected: Set<string>;
  /** Selected ids still present in the current scope (`getAllIds`). */
  readonly ids: string[];
  /** Count of selected ids in scope. */
  readonly count: number;
  /** True when every in-scope id is selected. */
  readonly allSelected: boolean;
  /** True when some, but not all, in-scope ids are selected. */
  readonly someSelected: boolean;
  isSelected(id: string): boolean;
  toggle(id: string): void;
  /** Select all in-scope ids, or clear them when all are already selected. */
  toggleAll(): void;
  /** Add a subset to the selection (e.g. "select all pending"). */
  add(ids: string[]): void;
  /** Remove a subset from the selection (e.g. after a partial bulk action). */
  remove(ids: string[]): void;
  /** Clear the entire selection. */
  clear(): void;
};

export type CreateListSelectionOptions = {
  /** All currently-selectable ids in scope; drives all/some/count + toggleAll. */
  getAllIds: () => string[];
  /** Whether the host `ListPage` is in selection mode; selection clears on exit. */
  isSelectionMode: () => boolean;
};

export function createListSelection(options: CreateListSelectionOptions): ListSelection {
  let selected = $state(new Set<string>());

  const allIds = $derived(options.getAllIds());
  const inScope = $derived(allIds.filter((id) => selected.has(id)));
  const allSelected = $derived(allIds.length > 0 && allIds.every((id) => selected.has(id)));
  const someSelected = $derived(inScope.length > 0 && !allSelected);

  // Exiting selection mode clears the selection (replaces the per-page $effect).
  $effect(() => {
    if (!options.isSelectionMode() && selected.size > 0) selected = new Set();
  });

  function mutate(fn: (next: Set<string>) => void): void {
    const next = new Set(selected);
    fn(next);
    selected = next;
  }

  return {
    get selectionMode() {
      return options.isSelectionMode();
    },
    get selected() {
      return selected;
    },
    get ids() {
      return inScope;
    },
    get count() {
      return inScope.length;
    },
    get allSelected() {
      return allSelected;
    },
    get someSelected() {
      return someSelected;
    },
    isSelected: (id) => selected.has(id),
    toggle: (id) =>
      mutate((next) => {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }),
    toggleAll() {
      selected = allSelected ? new Set() : new Set(allIds);
    },
    add: (ids) => mutate((next) => ids.forEach((id) => next.add(id))),
    remove: (ids) => mutate((next) => ids.forEach((id) => next.delete(id))),
    clear() {
      selected = new Set();
    },
  };
}
