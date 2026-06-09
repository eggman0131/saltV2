// spec: ui-spec-v04.md §9 v0.4
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';
import type { icons } from '@lucide/svelte';

/** Name of a Lucide icon, matching the {@link Icon} primitive's `name` prop. */
export type BulkActionIcon = keyof typeof icons;

/**
 * A single entry in the contextual bottom action bar (selection mode).
 *
 * - `button` (default): fires `onSelect` directly — e.g. Check, Uncheck, Delete.
 *   Use `variant: 'destructive'` to tint a delete action.
 * - `picker`: opens a template-owned bottom `Sheet` listing `targets`; choosing
 *   one fires `onPick(targetId)` — e.g. "Move to…".
 */
export type BulkAction =
  | {
      kind?: 'button';
      /** Stable key for the `{#each}` over actions. */
      id: string;
      label: string;
      icon: BulkActionIcon;
      variant?: 'default' | 'destructive';
      disabled?: boolean;
      /** Optional `data-testid` for the bar button (falls back to `list-page-bulk-action`). */
      testId?: string;
      onSelect: () => void;
    }
  | {
      kind: 'picker';
      id: string;
      label: string;
      icon: BulkActionIcon;
      disabled?: boolean;
      /** Optional `data-testid` for the bar button (falls back to `list-page-bulk-action`). */
      testId?: string;
      /** Title shown at the top of the target-picker sheet, e.g. "Move 3 items to…". */
      sheetTitle?: string;
      targets: { id: string; label: string }[];
      /** Optional `data-testid` for each target option (falls back to `list-page-bulk-picker-option`). */
      optionTestId?: string;
      onPick: (targetId: string) => void;
    };

export type ListPageProps = {
  title: string;
  titleSlot?: Snippet;
  description?: string;
  toolbar?: Snippet;
  /**
   * Top **select-all** control, rendered in the bar between the header and content
   * while in selection mode. Convention: a single select-all `Checkbox` whose label
   * shows the count ("3 selected" / "Select all"). Bulk actions do **not** go here —
   * they are declared via `bulkActions` and rendered in the contextual bottom bar
   * (ui-spec-v04 §9.3.1). The old inline grey-bar buttons (Delete/Clear) are removed.
   */
  selectionBar?: Snippet;
  selectionMode?: boolean;
  /**
   * Bulk actions for the contextual bottom action bar. When `selectionMode` is on
   * and `selectionCount > 0`, the template renders a fixed bottom bar (one button
   * per action) that takes over the area occupied by the app's `BottomNav`
   * (Android-style contextual action mode) and reserves matching content padding.
   * A `kind: 'picker'` action opens a template-owned bottom `Sheet` of targets.
   */
  bulkActions?: BulkAction[];
  /**
   * Number of currently-selected items. Drives contextual-bar visibility (the bar
   * shows only when `selectionMode && selectionCount > 0`) and the default
   * picker-sheet title. The page owns selection state; this is just the count.
   */
  selectionCount?: number;
  /**
   * Header action buttons, rendered to the right of the built-in Select/Done toggle.
   * Convention: use size="sm" on every button here so they line up with the Select
   * toggle (which is sm); mixing in the default md size leaves the row uneven.
   */
  actions?: Snippet;
  isLoading?: boolean;
  isError?: boolean;
  isEmpty?: boolean;
  loading?: Snippet;
  error?: Snippet;
  empty?: Snippet;
  children?: Snippet;
  class?: string;
} & Omit<HTMLAttributes<HTMLElement>, 'class'>;
